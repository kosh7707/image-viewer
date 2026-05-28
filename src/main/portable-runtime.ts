import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PortableLayout {
  portableRoot: string;
  appRoot: string;
  dataRoot: string;
  userDataDir: string;
  sessionDataDir: string;
  logsDir: string;
}

export interface ResolvePortableLayoutOptions {
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  execPath: string;
}

export interface ApplyPortableRuntimeOptions extends ResolvePortableLayoutOptions {
  ensureDir?: (dir: string) => void;
  setPath: (name: 'userData' | 'sessionData', value: string) => void;
  setAppLogsPath: (value: string) => void;
}

const PORTABLE_ROOT_ENV = 'IMAGEVIEWER_PORTABLE_ROOT';
const PORTABLE_ROOT_NAME = 'ImageViewerPortable';
const APP_PARENT_NAME = 'App';
const APP_DIR_NAME = 'ImageViewer';
const APP_EXECUTABLE_NAME = 'ImageViewer.exe';

function buildLayout(portableRoot: string): PortableLayout {
  const root = path.resolve(portableRoot);
  const appRoot = path.join(root, APP_PARENT_NAME, APP_DIR_NAME);
  const dataRoot = path.join(root, 'Data');
  return {
    portableRoot: root,
    appRoot,
    dataRoot,
    userDataDir: path.join(dataRoot, 'userData'),
    sessionDataDir: path.join(dataRoot, 'sessionData'),
    logsDir: path.join(dataRoot, 'logs'),
  };
}

function hasSegmentName(actual: string, expected: string): boolean {
  return actual.toLowerCase() === expected.toLowerCase();
}

function derivePortableRootFromExecPath(execPath: string): string | null {
  const resolvedExecPath = path.resolve(execPath);
  const exeName = path.basename(resolvedExecPath);
  const appRoot = path.dirname(resolvedExecPath);
  const appDir = path.basename(appRoot);
  const appParent = path.dirname(appRoot);
  const appParentDir = path.basename(appParent);
  const portableRoot = path.dirname(appParent);
  const portableRootDir = path.basename(portableRoot);

  if (
    hasSegmentName(exeName, APP_EXECUTABLE_NAME) &&
    hasSegmentName(appDir, APP_DIR_NAME) &&
    hasSegmentName(appParentDir, APP_PARENT_NAME) &&
    hasSegmentName(portableRootDir, PORTABLE_ROOT_NAME)
  ) {
    return portableRoot;
  }

  return null;
}

export function resolvePortableLayout(
  options: ResolvePortableLayoutOptions,
): PortableLayout | null {
  const envRoot = options.env[PORTABLE_ROOT_ENV]?.trim();
  if (envRoot) {
    return buildLayout(envRoot);
  }

  const derivedRoot = derivePortableRootFromExecPath(options.execPath);
  return derivedRoot ? buildLayout(derivedRoot) : null;
}

export function applyPortableRuntimePaths(
  options: ApplyPortableRuntimeOptions,
): PortableLayout | null {
  const layout = resolvePortableLayout(options);
  if (!layout) return null;

  const ensureDir = options.ensureDir ?? ((dir: string) => fs.mkdirSync(dir, { recursive: true }));
  ensureDir(layout.userDataDir);
  ensureDir(layout.sessionDataDir);
  ensureDir(layout.logsDir);

  options.setPath('userData', layout.userDataDir);
  options.setPath('sessionData', layout.sessionDataDir);
  options.setAppLogsPath(layout.logsDir);

  return layout;
}
