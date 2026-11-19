export function createStudioRequestGuard(initialSlug = '') {
  let slug = initialSlug;
  let generation = 0;
  const pending = new Map<string, AbortController>();

  const invalidate = () => {
    generation += 1;
    const controllers = [...pending.values()];
    pending.clear();
    controllers.forEach((controller) => controller.abort());
  };

  return {
    get slug() {
      return slug;
    },
    select(nextSlug: string) {
      if (slug === nextSlug) return false;
      slug = nextSlug;
      invalidate();
      return true;
    },
    invalidate,
    isPending: (slot: string) => pending.has(slot),
    begin(slot: string, expectedSlug = slug) {
      if (expectedSlug !== slug) return null;
      const requestGeneration = generation;
      const controller = new AbortController();
      const previous = pending.get(slot);
      pending.set(slot, controller);
      previous?.abort();

      const isCurrent = () =>
        generation === requestGeneration &&
        slug === expectedSlug &&
        pending.get(slot) === controller &&
        !controller.signal.aborted;

      return {
        signal: controller.signal,
        isCurrent,
        finish() {
          if (!isCurrent()) return false;
          pending.delete(slot);
          return true;
        },
      };
    },
  };
}
