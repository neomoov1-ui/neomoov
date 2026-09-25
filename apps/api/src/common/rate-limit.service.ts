/**
 * Compteurs à fenêtre fixe pour la limitation de débit (section 7.1 et 8) : par adresse IP, par utilisateur, par numéro
 * de téléphone, et pour interdire le rejeu d'un code TOTP. Redis quand il est configuré (partagé entre les instances de
 * l'API), sinon mémoire du processus (développement et tests).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../infra/redis.module.js';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Secondes avant la remise à zéro de la fenêtre. */
  resetIn: number;
}

@Injectable()
export class RateLimitService {
  private readonly memory = new Map<string, { count: number; expiresAt: number }>();
  private sweepCounter = 0;

  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  /** Incrémente le compteur `key` dans une fenêtre de `windowSeconds` et compare à `limit`. */
  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const { count, resetIn } = await this.increment(`rl:${key}`, windowSeconds);
    return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetIn };
  }

  /** Marque `key` comme utilisée pendant `ttlSeconds` ; renvoie faux si elle l'était déjà (rejeu). */
  async claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
    const { count } = await this.increment(`once:${key}`, ttlSeconds);
    return count === 1;
  }

  /** Lecture sans incrément (affichage du délai restant). */
  async peek(key: string): Promise<{ count: number; resetIn: number }> {
    const full = `rl:${key}`;
    if (this.redis) {
      const [count, pttl] = await Promise.all([this.redis.get(full), this.redis.pttl(full)]);
      return { count: Number(count ?? 0), resetIn: Math.max(0, Math.ceil(pttl / 1000)) };
    }
    const entry = this.memory.get(full);
    if (!entry || entry.expiresAt <= Date.now()) return { count: 0, resetIn: 0 };
    return { count: entry.count, resetIn: Math.ceil((entry.expiresAt - Date.now()) / 1000) };
  }

  /** Pose un drapeau pendant `ttlSeconds` (session révoquée, code TOTP consommé). */
  async flag(key: string, ttlSeconds: number): Promise<void> {
    if (this.redis) {
      await this.redis.set(`flag:${key}`, '1', 'EX', ttlSeconds);
      return;
    }
    this.sweep();
    this.memory.set(`flag:${key}`, { count: 1, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async hasFlag(key: string): Promise<boolean> {
    if (this.redis) return (await this.redis.exists(`flag:${key}`)) === 1;
    const entry = this.memory.get(`flag:${key}`);
    return Boolean(entry && entry.expiresAt > Date.now());
  }

  /** Efface un compteur (réussite d'une connexion, tests). */
  async reset(key: string): Promise<void> {
    if (this.redis) {
      await this.redis.del(`rl:${key}`);
      return;
    }
    this.memory.delete(`rl:${key}`);
  }

  private async increment(fullKey: string, windowSeconds: number): Promise<{ count: number; resetIn: number }> {
    if (this.redis) {
      const results = await this.redis.multi().incr(fullKey).expire(fullKey, windowSeconds, 'NX').pttl(fullKey).exec();
      const count = Number(results?.[0]?.[1] ?? 1);
      const pttl = Number(results?.[2]?.[1] ?? windowSeconds * 1000);
      return { count, resetIn: Math.max(1, Math.ceil(pttl / 1000)) };
    }
    this.sweep();
    const now = Date.now();
    const entry = this.memory.get(fullKey);
    if (!entry || entry.expiresAt <= now) {
      this.memory.set(fullKey, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return { count: 1, resetIn: windowSeconds };
    }
    entry.count += 1;
    return { count: entry.count, resetIn: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)) };
  }

  /** Nettoyage périodique des fenêtres expirées (toutes les 1 000 opérations) pour borner la mémoire. */
  private sweep() {
    this.sweepCounter += 1;
    if (this.sweepCounter % 1000 !== 0) return;
    const now = Date.now();
    for (const [key, entry] of this.memory) if (entry.expiresAt <= now) this.memory.delete(key);
  }
}
