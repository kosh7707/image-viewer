import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

export interface EpsRenderResult {
  data: Uint8Array;
  width: number;
  height: number;
  renderMs: number;
}

export interface EpsRenderOptions {
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
}

interface EpsWorkerSuccess {
  type: 'success';
  data: ArrayBuffer;
  width: number;
  height: number;
  renderMs: number;
}

interface EpsWorkerFailure {
  type: 'error';
  message: string;
}

type EpsWorkerMessage = EpsWorkerSuccess | EpsWorkerFailure;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_INPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const MAX_CONCURRENT_EPS_RENDERS = 1;
const MAX_QUEUED_EPS_RENDERS = 64;

let activeRenderCount = 0;
const pendingJobs: Array<() => void> = [];

export async function renderEpsToPng(
  filePath: string,
  options: EpsRenderOptions = {},
): Promise<EpsRenderResult> {
  const resolved = path.resolve(filePath);
  const stat = await fs.promises.stat(resolved);
  if (!stat.isFile()) {
    throw new Error('EPS path is not a file');
  }
  const maxInputBytes = positiveNumberOr(options.maxInputBytes, DEFAULT_MAX_INPUT_BYTES);
  if (stat.size > maxInputBytes) {
    throw new Error(`EPS file is too large: ${stat.size} bytes`);
  }

  return await enqueueEpsRender(() =>
    runEpsWorker(resolved, {
      timeoutMs: positiveNumberOr(options.timeoutMs, DEFAULT_TIMEOUT_MS),
      maxOutputBytes: positiveNumberOr(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES),
    }),
  );
}

function enqueueEpsRender(job: () => Promise<EpsRenderResult>): Promise<EpsRenderResult> {
  if (pendingJobs.length >= MAX_QUEUED_EPS_RENDERS) {
    return Promise.reject(new Error('Too many EPS render jobs are queued'));
  }

  return new Promise((resolve, reject) => {
    pendingJobs.push(() => {
      void job().then(resolve, reject).finally(finishEpsRenderJob);
    });
    pumpEpsRenderQueue();
  });
}

function pumpEpsRenderQueue(): void {
  while (activeRenderCount < MAX_CONCURRENT_EPS_RENDERS) {
    const next = pendingJobs.shift();
    if (!next) return;
    activeRenderCount += 1;
    next();
  }
}

function finishEpsRenderJob(): void {
  activeRenderCount = Math.max(0, activeRenderCount - 1);
  pumpEpsRenderQueue();
}

function runEpsWorker(
  filePath: string,
  options: { timeoutMs: number; maxOutputBytes: number },
): Promise<EpsRenderResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'eps-render-worker.js'), {
      workerData: {
        filePath,
        maxOutputBytes: options.maxOutputBytes,
      },
    });
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => {
        void worker.terminate();
        reject(new Error('EPS render timed out'));
      });
    }, options.timeoutMs);

    worker.once('message', (message: EpsWorkerMessage) => {
      settle(() => {
        if (message.type === 'success') {
          resolve({
            data: new Uint8Array(message.data),
            width: message.width,
            height: message.height,
            renderMs: message.renderMs,
          });
        } else {
          reject(new Error(message.message));
        }
      });
    });

    worker.once('error', (error) => {
      settle(() => {
        reject(error);
      });
    });

    worker.once('exit', (code) => {
      if (code === 0) return;
      settle(() => {
        reject(new Error(`EPS render worker exited with code ${code}`));
      });
    });
  });
}

function positiveNumberOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
