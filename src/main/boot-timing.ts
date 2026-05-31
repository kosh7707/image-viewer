import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BootTimingLoggerOptions {
  fileName?: string;
  maxRecords?: number;
  now?: () => string;
  runId?: string;
}

export interface BootTimingLogger {
  log(event: string, data?: Record<string, unknown>): void;
}

interface BootTimingRecord {
  ts: string;
  runId: string;
  event: string;
  data?: Record<string, unknown>;
}

function defaultRunId(): string {
  return `${Date.now().toString(36)}-${process.pid.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createBootTimingLogger(
  logsDir: string,
  options: BootTimingLoggerOptions = {},
): BootTimingLogger {
  const fileName = options.fileName ?? 'boot-times.jsonl';
  const maxRecords = Math.max(1, Math.floor(options.maxRecords ?? 80));
  const now = options.now ?? (() => new Date().toISOString());
  const runId = options.runId ?? defaultRunId();
  const logPath = path.join(logsDir, fileName);

  return {
    log(event: string, data?: Record<string, unknown>): void {
      fs.mkdirSync(logsDir, { recursive: true });
      const record: BootTimingRecord = { ts: now(), runId, event };
      if (data && Object.keys(data).length > 0) {
        record.data = data;
      }

      const existing = fs.existsSync(logPath)
        ? fs
            .readFileSync(logPath, 'utf8')
            .split(/\r?\n/)
            .filter((line) => line.trim().length > 0)
        : [];

      const next = [...existing, JSON.stringify(record)].slice(-maxRecords);
      fs.writeFileSync(logPath, `${next.join('\n')}\n`, 'utf8');
    },
  };
}
