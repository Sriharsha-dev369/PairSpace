// Deterministic random numbers, so a run can be replayed exactly from its seed.
export function seededRandom(seed: number) {
  let state = seed % 2147483647 || 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}
