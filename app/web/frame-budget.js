// Use measured cadence rather than assuming every display runs at 120 Hz.
export function evaluateFrameBudget(samples) {
  const frames = samples.filter(delta => Number.isFinite(delta) && delta > 0);
  if (!frames.length) return null;
  const sorted = [...frames].sort((a, b) => a - b);
  const cadence = sorted[Math.floor(sorted.length * 0.2)];
  const average = frames.reduce((sum, delta) => sum + delta, 0) / frames.length;
  const slowRatio = frames.filter(delta => delta > cadence * 1.8).length / frames.length;
  const fps = Math.round(1000 / average);
  return { fps, perf: fps < 45 || (average > cadence * 1.6 && slowRatio > 0.2) ? 'low' : 'high' };
}
