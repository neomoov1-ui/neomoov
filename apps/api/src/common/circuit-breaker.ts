/**
 * Disjoncteur des fournisseurs externes (prompt 15, tâche 4) : après `failureThreshold` échecs consécutifs, le circuit
 * s'ouvre et les appels échouent aussitôt (sans attendre le délai du fournisseur) pendant `cooldownMs` ; ensuite un seul
 * appel d'essai passe (demi-ouvert) : réussi, le circuit se referme, raté, il se rouvre. L'appelant garde son mode
 * dégradé (devis estimé, autre canal, file de reprise) : le disjoncteur ne fait que le déclencher plus vite.
 */
import { Injectable } from '@nestjs/common';

export class CircuitOpenError extends Error {
  constructor(readonly circuit: string) {
    super(`Circuit ${circuit} ouvert : fournisseur indisponible, mode dégradé`);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitOptions {
  failureThreshold: number;
  cooldownMs: number;
}

export type CircuitState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private trial = false;

  constructor(
    readonly name: string,
    private readonly options: CircuitOptions = { failureThreshold: 5, cooldownMs: 30_000 },
    private readonly clock: () => number = Date.now,
  ) {}

  get state(): CircuitState {
    if (this.openedAt === null) return 'closed';
    return this.clock() - this.openedAt >= this.options.cooldownMs ? 'half_open' : 'open';
  }

  async run<T>(call: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === 'open' || (state === 'half_open' && this.trial)) throw new CircuitOpenError(this.name);
    if (state === 'half_open') this.trial = true;
    try {
      const result = await call();
      this.failures = 0;
      this.openedAt = null;
      return result;
    } catch (error) {
      this.failures += 1;
      if (state === 'half_open' || this.failures >= this.options.failureThreshold) this.openedAt = this.clock();
      throw error;
    } finally {
      if (state === 'half_open') this.trial = false;
    }
  }

  snapshot(): { name: string; state: CircuitState; failures: number } {
    return { name: this.name, state: this.state, failures: this.failures };
  }
}

/** Disjoncteurs partagés du processus, par fournisseur (état exposé par la santé détaillée). */
@Injectable()
export class CircuitBreakers {
  private readonly circuits = new Map<string, CircuitBreaker>();

  get(name: string, options?: CircuitOptions): CircuitBreaker {
    let circuit = this.circuits.get(name);
    if (!circuit) {
      circuit = new CircuitBreaker(name, options);
      this.circuits.set(name, circuit);
    }
    return circuit;
  }

  snapshot() {
    return [...this.circuits.values()].map((c) => c.snapshot());
  }
}
