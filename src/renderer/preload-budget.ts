export type PreloadBudgetKind = 'static' | 'animated';

export interface PreloadBudgetCandidate {
  path: string;
  index: number;
  kind: PreloadBudgetKind;
  bytes: number;
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
  for (const candidate of candidates
    .filter((candidate) => Number.isFinite(candidate.bytes) && candidate.bytes > 0)
    .sort(
      (a, b) =>
        wrapDistance(a.index, currentIndex, totalEntries) -
          wrapDistance(b.index, currentIndex, totalEntries) || a.index - b.index,
    )) {
    if (candidate.bytes > totalLimit) continue;
    if (plannedBytes + candidate.bytes > totalLimit) continue;
    plannedBytes += candidate.bytes;
    plan.allowedPaths.add(candidate.path);
    if (candidate.kind === 'static') {
      plan.staticBytes += candidate.bytes;
    } else {
      plan.animatedBytes += candidate.bytes;
    }
  }

  return plan;
}

export function wrapDistance(index: number, currentIndex: number, total: number): number {
  if (total <= 0) return 0;
  const delta = Math.abs(index - currentIndex);
  return Math.min(delta, total - delta);
}
