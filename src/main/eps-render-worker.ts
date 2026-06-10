import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

interface EpsRenderWorkerData {
  filePath: string;
  maxOutputBytes: number;
}

interface GhostscriptModule {
  callMain(args?: string[]): number;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
}

type GhostscriptModuleFactory = (options: {
  locateFile?: (filePath: string) => string;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}) => Promise<GhostscriptModule>;

const DEFAULT_DPI = 144;
const MIN_DPI = 18;
const MAX_RENDER_DIMENSION = 4096;
const MAX_RENDER_PIXELS = 32 * 1024 * 1024;

void render().catch((error) => {
  parentPort?.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
});

async function render(): Promise<void> {
  const data = workerData as EpsRenderWorkerData;
  const started = Date.now();
  const epsBytes = fs.readFileSync(data.filePath);
  const dpi = chooseRenderDpi(epsBytes);
  const assetDir = resolveGhostscriptAssetDir();
  const moduleUrl = pathToFileURL(path.join(assetDir, 'gs.js')).href;
  const module = await dynamicImport<{ default: GhostscriptModuleFactory }>(moduleUrl);
  const errors: string[] = [];
  const gs = await module.default({
    locateFile: (filePath) => pathToFileURL(path.join(assetDir, filePath)).href,
    print: () => undefined,
    printErr: (text) => {
      const line = String(text);
      if (!line.includes('Ghostscript')) errors.push(line);
    },
  });

  const inputPath = '/input.eps';
  const outputPath = '/output.png';
  gs.FS.writeFile(inputPath, epsBytes);
  const status = gs.callMain([
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    '-dEPSCrop',
    '-dGraphicsAlphaBits=4',
    '-dTextAlphaBits=4',
    `-r${dpi}`,
    '-sDEVICE=png16m',
    `-sOutputFile=${outputPath}`,
    inputPath,
  ]);
  if (status !== 0) {
    throw new Error(`Ghostscript failed with status ${status}${errorSuffix(errors)}`);
  }

  const output = Buffer.from(gs.FS.readFile(outputPath));
  if (output.byteLength > data.maxOutputBytes) {
    throw new Error(`Rendered EPS PNG is too large: ${output.byteLength} bytes`);
  }
  const dimensions = pngDimensions(output);
  const exact = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
  parentPort?.postMessage(
    {
      type: 'success',
      data: exact,
      width: dimensions.width,
      height: dimensions.height,
      renderMs: Date.now() - started,
    },
    [exact],
  );

  try {
    gs.FS.unlink(inputPath);
    gs.FS.unlink(outputPath);
  } catch {
    // The worker exits immediately after this render, so FS cleanup is best-effort.
  }
}

function resolveGhostscriptAssetDir(): string {
  const packageRoot = resolveGhostscriptPackageRoot();
  const assetDir = path.join(packageRoot, 'assets');
  const unpackedAssetDir = assetDir.replace(/\.asar(?=[\\/])/, '.asar.unpacked');
  if (unpackedAssetDir !== assetDir && fs.existsSync(path.join(unpackedAssetDir, 'gs.js'))) {
    return unpackedAssetDir;
  }
  return assetDir;
}

function resolveGhostscriptPackageRoot(): string {
  const packageParts = ['node_modules', '@bentopdf', 'gs-wasm'];
  const candidates = [
    path.join(path.resolve(__dirname, '..', '..', '..'), ...packageParts),
    path.join(process.cwd(), ...packageParts),
  ];

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    candidates.push(
      path.join(resourcesPath, 'app.asar.unpacked', ...packageParts),
      path.join(resourcesPath, 'app.asar', ...packageParts),
      path.join(resourcesPath, 'app', ...packageParts),
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'assets', 'gs.js'))) {
      return candidate;
    }
  }

  throw new Error('Ghostscript WASM assets were not found');
}

function dynamicImport<T>(specifier: string): Promise<T> {
  const importFn = new Function('specifier', 'return import(specifier)') as (
    value: string,
  ) => Promise<T>;
  return importFn(specifier);
}

function chooseRenderDpi(epsBytes: Buffer): number {
  const box = parseBoundingBox(epsBytes);
  if (!box) return DEFAULT_DPI;

  const widthPt = box.widthPt;
  const heightPt = box.heightPt;
  if (widthPt <= 0 || heightPt <= 0) return DEFAULT_DPI;

  const widthAtDefault = (widthPt * DEFAULT_DPI) / 72;
  const heightAtDefault = (heightPt * DEFAULT_DPI) / 72;
  const dimensionScale = Math.min(
    1,
    MAX_RENDER_DIMENSION / Math.max(widthAtDefault, heightAtDefault),
  );
  const pixelScale = Math.min(
    1,
    Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, widthAtDefault * heightAtDefault)),
  );
  const dpi = Math.floor(DEFAULT_DPI * Math.min(dimensionScale, pixelScale));
  return Math.max(MIN_DPI, Math.min(DEFAULT_DPI, dpi));
}

function parseBoundingBox(epsBytes: Buffer): { widthPt: number; heightPt: number } | null {
  const header = epsBytes.toString('latin1', 0, Math.min(epsBytes.byteLength, 128 * 1024));
  const match = header.match(
    /^%%(?:HiRes)?BoundingBox:\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)/im,
  );
  if (!match) return null;
  const left = Number(match[1]);
  const bottom = Number(match[2]);
  const right = Number(match[3]);
  const top = Number(match[4]);
  if (![left, bottom, right, top].every(Number.isFinite)) return null;
  return {
    widthPt: Math.abs(right - left),
    heightPt: Math.abs(top - bottom),
  };
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.byteLength < 24 || !bytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error('Ghostscript did not produce a PNG');
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function errorSuffix(errors: string[]): string {
  const tail = errors
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(' | ');
  return tail ? `: ${tail}` : '';
}
