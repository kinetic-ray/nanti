type Diagnostic = {
  reason: string;
  status?: number;
};

type State = {
  failures: number;
  openUntil: number;
  probing: boolean;
  generation: number;
};

const transientFailures = new Set([
  'timeout',
  'destination_timeout',
  'dns_failure',
  'connection_failure',
  'tls_failure',
]);

export function createMarketplaceCircuitBreaker() {
  const states = new Map<string, State>();
  const threshold = 5;
  const cooldown = 30_000;

  function acquire(merchant: string) {
    let state = states.get(merchant);

    if (!state) {
      state = {
        failures: 0,
        openUntil: 0,
        probing: false,
        generation: 0,
      };

      states.set(merchant, state);
    }

    const current = state;

    if (current.openUntil > Date.now() || current.probing) {
      return null;
    }

    const probe = current.openUntil !== 0;
    const generation = current.generation;

    if (probe) current.probing = true;

    let completed = false;

    return (success: boolean, diagnostics: Diagnostic[]) => {
      if (completed) return;
      completed = true;

      if (current.generation !== generation) return;

      const transient = !success && diagnostics.some(diagnostic =>
        transientFailures.has(diagnostic.reason) ||
        (
          diagnostic.reason === 'http_failure' &&
          diagnostic.status !== undefined &&
          diagnostic.status >= 500 &&
          diagnostic.status <= 599
        ),
      );

      if (probe) current.probing = false;

      if (success) {
        current.failures = 0;
        current.openUntil = 0;
        if (probe) current.generation++;
        return;
      }

      if (!transient) {
        if (probe) {
          current.openUntil = Date.now() + cooldown;
          current.generation++;
        } else {
          current.failures = 0;
        }
        return;
      }

      current.failures++;

      if (probe || current.failures >= threshold) {
        current.openUntil = Date.now() + cooldown;
        current.generation++;
      }
    };
  }

  return { acquire };
}
