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

  async driverIdOf(userId: string): Promise<string | null> {
    const [row] = await this.database.db.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.userId, userId)).limit(1);
    return row?.id ?? null;
  }

  isStaff(actor: UserActor): boolean {
    return hasStaffRole(actor.roles);
  }
}
