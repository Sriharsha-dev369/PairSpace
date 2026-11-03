// how long something took: "<1 ms", "12 ms" under a second, then "3.4 s"
export function duration(ms: number): string {
  if (ms < 1) return "<1 ms"; // "0 ms" would read as broken
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
