/**
 * Adaptateur Socket.IO de l'API : mêmes origines CORS que le HTTP (`CORS_ORIGINS`, sinon l'adresse du web) et, avec
 * Redis, salles et émissions partagées entre les instances (deux connexions dédiées). Fermeture propre à l'arrêt.
 */
import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

export class AppIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pub: Redis | null = null;
  private sub: Redis | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly corsOrigins: string[],
    private readonly redis: Redis | null,
  ) {
    super(app);
  }

  async connect(): Promise<void> {
    if (!this.redis) return;
    this.pub = this.redis.duplicate();
    this.sub = this.redis.duplicate();
    await Promise.all([this.pub.connect(), this.sub.connect()]);
    this.adapterConstructor = createAdapter(this.pub, this.sub);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    // Socket.IO accepte des options partielles ; le type Nest exige l'objet complet, d'où l'assertion.
    const withCors = { ...options, cors: { origin: this.corsOrigins, credentials: true } } as ServerOptions;
    const server = super.createIOServer(port, withCors);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  override async close(server: Parameters<IoAdapter['close']>[0]): Promise<void> {
    await Promise.resolve(super.close(server));
    await Promise.all([this.pub?.quit().catch(() => undefined), this.sub?.quit().catch(() => undefined)]);
    this.pub = null;
    this.sub = null;
  }
}
