import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { SUPPORTED_EXTS } from './folder';

export const MENU_LABEL = 'ImageViewer로 열기';
export const VERB_NAME = 'ImageViewer.Open';

export type ShellIntegrationTargetKind = 'extension' | 'folder';
export type ShellIntegrationState = 'registered' | 'not-registered' | 'partial' | 'unavailable';

export interface ShellIntegrationTarget {
  id: string;
  kind: ShellIntegrationTargetKind;
  keyPath: string;
  commandKeyPath: string;
}

export interface ShellIntegrationTargetStatus {
  id: string;
  kind: ShellIntegrationTargetKind;
  registered: boolean;
  present?: boolean;
  actualCommand?: string;
}

export interface ShellIntegrationStatus {
  available: boolean;
  state: ShellIntegrationState;
  expectedCommand: string;
  targets: ShellIntegrationTargetStatus[];
  message?: string;
}

export interface RegistryOperation {
  args: string[];
  ignoreFailure?: boolean;
}

export interface RegistryCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RegistryRunner {
  run(args: string[]): Promise<RegistryCommandResult>;
}

export interface ShellIntegrationOptions {
  exePath?: string;
  platform?: NodeJS.Platform;
  runner?: RegistryRunner;
}

function targetFromKey(id: string, kind: ShellIntegrationTargetKind, keyPath: string) {
  return {
    id,
    kind,
    keyPath,
    commandKeyPath: `${keyPath}\\command`,
  };
}

export function shellIntegrationTargets(): ShellIntegrationTarget[] {
  return [
    ...SUPPORTED_EXTS.map((ext) =>
      targetFromKey(
        ext,
        'extension',
        `HKCU\\Software\\Classes\\SystemFileAssociations\\${ext}\\shell\\${VERB_NAME}`,
      ),
    ),
    targetFromKey('folder', 'folder', `HKCU\\Software\\Classes\\Directory\\shell\\${VERB_NAME}`),
  ];
}

export function buildShellIntegrationCommand(exePath: string): string {
  return `"${path.resolve(exePath)}" "%1"`;
}

export function buildRegisterOperations(exePath: string): RegistryOperation[] {
  const resolvedExe = path.resolve(exePath);
  const command = buildShellIntegrationCommand(resolvedExe);
  const operations: RegistryOperation[] = [];
  for (const target of shellIntegrationTargets()) {
    operations.push(
      { args: ['add', target.keyPath, '/ve', '/d', MENU_LABEL, '/f'] },
      { args: ['add', target.keyPath, '/v', 'MUIVerb', '/t', 'REG_SZ', '/d', MENU_LABEL, '/f'] },
      { args: ['add', target.keyPath, '/v', 'Icon', '/t', 'REG_SZ', '/d', resolvedExe, '/f'] },
      { args: ['add', target.commandKeyPath, '/ve', '/d', command, '/f'] },
    );
  }
  return operations;
}

export function buildUnregisterOperations(): RegistryOperation[] {
  return shellIntegrationTargets().map((target) => ({
    args: ['delete', target.keyPath, '/f'],
    ignoreFailure: true,
  }));
}

export function statusFromTargetStatuses(
  targets: readonly ShellIntegrationTargetStatus[],
): ShellIntegrationState {
  if (targets.length === 0) return 'not-registered';
  const registeredCount = targets.filter((target) => target.registered).length;
  if (registeredCount === targets.length) return 'registered';

  const presentCount = targets.filter((target) => target.present ?? target.registered).length;
  if (presentCount === 0) return 'not-registered';
  return 'partial';
}

export function parseDefaultRegSz(stdout: string): string | null {
  const line = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => /\bREG_SZ\b/i.test(value));
  if (!line) return null;
  const match = line.match(/\bREG_SZ\b\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function commandsEqual(left: string | null, right: string): boolean {
  if (!left) return false;
  return left.trim().replace(/\s+/g, ' ').toLowerCase() === right.trim().toLowerCase();
}

function defaultRunner(): RegistryRunner {
  return {
    run(args: string[]) {
      return new Promise<RegistryCommandResult>((resolve) => {
        execFile(
          'reg.exe',
          args,
          { windowsHide: true, encoding: 'utf8' },
          (error, stdout, stderr) => {
            const code = (error as (Error & { code?: unknown }) | null)?.code;
            resolve({
              exitCode: typeof code === 'number' ? code : error ? 1 : 0,
              stdout: String(stdout ?? ''),
              stderr: String(stderr ?? ''),
            });
          },
        );
      });
    },
  };
}

async function runOperations(
  operations: readonly RegistryOperation[],
  runner: RegistryRunner,
): Promise<void> {
  for (const op of operations) {
    const result = await runner.run(op.args);
    if (result.exitCode !== 0 && !op.ignoreFailure) {
      throw new Error(result.stderr.trim() || `reg.exe failed: ${op.args.join(' ')}`);
    }
  }
}

async function queryTargetStatus(
  target: ShellIntegrationTarget,
  expectedCommand: string,
  runner: RegistryRunner,
): Promise<ShellIntegrationTargetStatus> {
  const result = await runner.run(['query', target.commandKeyPath, '/ve']);
  if (result.exitCode !== 0) {
    return {
      id: target.id,
      kind: target.kind,
      registered: false,
      present: false,
    };
  }

  const actualCommand = parseDefaultRegSz(result.stdout);
  return {
    id: target.id,
    kind: target.kind,
    registered: commandsEqual(actualCommand, expectedCommand),
    present: actualCommand !== null,
    actualCommand: actualCommand ?? undefined,
  };
}

export async function getShellIntegrationStatus(
  options: ShellIntegrationOptions = {},
): Promise<ShellIntegrationStatus> {
  const exePath = path.resolve(options.exePath ?? process.execPath);
  const expectedCommand = buildShellIntegrationCommand(exePath);
  if ((options.platform ?? process.platform) !== 'win32') {
    return {
      available: false,
      state: 'unavailable',
      expectedCommand,
      targets: [],
      message: 'Windows shell integration is available on Windows only.',
    };
  }

  const runner = options.runner ?? defaultRunner();
  const targets = await Promise.all(
    shellIntegrationTargets().map((target) => queryTargetStatus(target, expectedCommand, runner)),
  );
  return {
    available: true,
    state: statusFromTargetStatuses(targets),
    expectedCommand,
    targets,
  };
}

export async function registerShellIntegration(
  options: ShellIntegrationOptions = {},
): Promise<ShellIntegrationStatus> {
  const exePath = path.resolve(options.exePath ?? process.execPath);
  if ((options.platform ?? process.platform) !== 'win32') {
    return await getShellIntegrationStatus(options);
  }

  const runner = options.runner ?? defaultRunner();
  await runOperations(buildRegisterOperations(exePath), runner);
  return await getShellIntegrationStatus({ ...options, exePath, runner });
}

export async function unregisterShellIntegration(
  options: ShellIntegrationOptions = {},
): Promise<ShellIntegrationStatus> {
  if ((options.platform ?? process.platform) !== 'win32') {
    return await getShellIntegrationStatus(options);
  }

  const runner = options.runner ?? defaultRunner();
  await runOperations(buildUnregisterOperations(), runner);
  return await getShellIntegrationStatus({ ...options, runner });
}
