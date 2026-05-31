export type PreloadBudgetKind = 'static' | 'animated';

export interface PreloadBudgetCandidate {
  path: string;
  index: number;
  kind: PreloadBudgetKind;
  /** Null means the decoded size is unknown until renderer-side preload. */
  bytes: number | null;
}

export interface PreloadBudgetPlan {
  allowedPaths: Set<string>;
  staticBytes: number;
  animatedBytes: number;
}

export function planPreloadBudgetCandidates({
  candidates,
  currentIndex,
  totalEntries,
  totalLimit,
}: {
  candidates: PreloadBudgetCandidate[];
  currentIndex: number;
  totalEntries: number;
  totalLimit: number;
}): PreloadBudgetPlan {
  const plan: PreloadBudgetPlan = {
    allowedPaths: new Set<string>(),
    staticBytes: 0,
    animatedBytes: 0,
  };

  let plannedBytes = 0;
  let hasUnknownStatic = false;
  const unknownStaticBytes = unknownStaticPlanningBytes(totalLimit);
  for (const candidate of candidates
    .filter((candidate) => {
      return candidate.bytes === null || (Number.isFinite(candidate.bytes) && candidate.bytes > 0);
    })
    .sort(
      (a, b) =>
        wrapDistance(a.index, currentIndex, totalEntries) -
          wrapDistance(b.index, currentIndex, totalEntries) || a.index - b.index,
    )) {
    const planningBytes =
      candidate.bytes ?? (candidate.kind === 'static' ? unknownStaticBytes : totalLimit);
    if (planningBytes > totalLimit) continue;
    if (plannedBytes + planningBytes > totalLimit) continue;
    plannedBytes += planningBytes;
    plan.allowedPaths.add(candidate.path);
    if (candidate.kind === 'static') {
      if (candidate.bytes === null) {
        hasUnknownStatic = true;
      } else {
        plan.staticBytes += candidate.bytes;
      }
    } else {
      plan.animatedBytes += planningBytes;
    }
  }

  if (hasUnknownStatic) {
    plan.staticBytes = Math.max(plan.staticBytes, totalLimit - plan.animatedBytes);
  }

  return plan;
}

export function wrapDistance(index: number, currentIndex: number, total: number): number {
  if (total <= 0) return 0;
  const delta = Math.abs(index - currentIndex);
  return Math.min(delta, total - delta);
}

function unknownStaticPlanningBytes(totalLimit: number): number {
  if (!Number.isFinite(totalLimit) || totalLimit <= 0) return 1;
  return Math.max(1, Math.ceil(totalLimit / 64));
}
