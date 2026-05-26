import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const RUN_SMOKE = process.env.IMAGE_VIEWER_RUN_ELECTRON_SMOKE === '1';

test(
  'Electron renderer boots, advances GIF, speed-controls animated WebP, and falls back for static WebP',
  { skip: RUN_SMOKE ? false : 'set IMAGE_VIEWER_RUN_ELECTRON_SMOKE=1 to run Electron smoke test' },
  async () => {
    const requireFromHere = createRequire(__filename);
    const electronPath = requireFromHere('electron') as string;
    const scriptPath = path.join(process.cwd(), 'scripts', 'smoke-renderer-runtime.js');

    const result = await runSmokeProcess(electronPath, [scriptPath], 15_000);
    assert.equal(result.status, 'ok', result.details);
  },
);

interface SmokeResult {
  status: string;
  details: string;
}

function runSmokeProcess(command: string, args: string[], timeoutMs: number): Promise<SmokeResult> {
  return new Promise((resolve, reject) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-smoke-parent-'));
    const resultPath = path.join(tempDir, 'result.json');
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        IMAGE_VIEWER_SMOKE_RESULT: resultPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let exitCode: number | null = null;

    const finish = (result: SmokeResult): void => {
      clearTimeout(timer);
      clearInterval(poll);
      killProcessTree(child);
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      resolve(result);
    };

    const readResult = (): SmokeResult | null => {
      if (!fs.existsSync(resultPath)) return null;
      try {
        const raw = fs.readFileSync(resultPath, 'utf8');
        const parsed = JSON.parse(raw) as { status?: string; details?: unknown };
        return {
          status: parsed.status ?? 'fail',
          details: JSON.stringify(parsed.details ?? {}),
        };
      } catch {
        return null;
      }
    };

    const poll = setInterval(() => {
      const result = readResult();
      if (result) finish(result);
      if (exitCode !== null) {
        finish({
          status: 'fail',
          details: `electron exited before writing result: ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        });
      }
    }, 100);

    const timer = setTimeout(() => {
      clearInterval(poll);
      killProcessTree(child);
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      reject(new Error(`timed out after ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      clearInterval(poll);
      reject(err);
    });
    child.on('exit', (code) => {
      exitCode = code;
    });
  });
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch {
    // ignore cleanup failures
  }
}
