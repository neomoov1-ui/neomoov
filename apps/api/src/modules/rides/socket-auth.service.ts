/** Authentification d'une connexion Socket.IO par jeton d'accès (`auth.token` de la poignée de main, ou en-tête Authorization). */
import { schema } from '@neomoov/db';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Socket } from 'socket.io';
import { DB, type Database } from '../../infra/db.module.js';
import { hasStaffRole, type UserActor } from '../auth/actor.js';
import { TokensService } from '../auth/tokens.service.js';

@Injectable()
export class SocketAuthService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly tokens: TokensService,
  ) {}

  /** Acteur du socket, ou null si le jeton manque ou est invalide (le socket est alors fermé). */
  async authenticate(socket: Socket): Promise<UserActor | null> {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    const header = socket.handshake.headers.authorization;
    const token = typeof auth?.token === 'string' ? auth.token : header?.toLowerCase().startsWith('bearer ') ? header.slice(7) : null;
    if (!token) return null;
    try {
      const claims = await this.tokens.verifyAccessToken(token);
      return { kind: 'user', userId: claims.userId, sessionId: claims.sessionId, primaryRole: claims.primaryRole, roles: claims.roles, amr: claims.amr };
    } catch {
      return null;
    }
  }

  /**
   * Revue du 2 octobre 2026 (sécurité 14) : acteur du socket encore valable, la session étant relue à chaque message (une
   * déconnexion ou une révocation par le personnel survient souvent après la poignée de main). Session révoquée : le
   * message est refusé et le socket fermé juste après l'acquittement.
   */
  async current(socket: Socket): Promise<UserActor | null> {
    const actor = (socket.data as { actor?: UserActor }).actor;
    if (!actor) return null;
    if (!(await this.tokens.isSessionRevoked(actor.sessionId))) return actor;
    delete (socket.data as { actor?: UserActor }).actor;
    setTimeout(() => socket.disconnect(true), 0);
    return null;
  }

  /** Sockets qui ne font qu'écouter (suivi, carte de My Hub) : session relue chaque minute, fermés dès sa révocation. */
  watch(socket: Socket, everyMs = 60_000): void {
    const timer = setInterval(() => {
      this.current(socket).catch(() => undefined);
    }, everyMs);
    timer.unref?.();
    socket.once('disconnect', () => clearInterval(timer));
  }

  async driverIdOf(userId: string): Promise<string | null> {
    const [row] = await this.database.db.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.userId, userId)).limit(1);
    return row?.id ?? null;
  }

  isStaff(actor: UserActor): boolean {
    return hasStaffRole(actor.roles);
  }
}
