import { describe, expect, it, vi } from 'vitest';
import { createSessionEnd, isRefreshRefused, type SessionEndReason } from '../src/session-end';

describe('sortie de session', () => {
  it('passe toutes les étapes dans l\'ordre, même après un échec, et nomme celles en échec', async () => {
    const order: string[] = [];
    const onError = vi.fn();
    const end = createSessionEnd(
      [
        { name: 'localisation', run: () => void order.push('localisation') },
        { name: 'notifications', run: async () => { order.push('notifications'); throw new Error('réseau'); } },
        { name: 'session', run: async () => void order.push('session') },
      ],
      onError,
    );
    expect(await end('logout')).toEqual(['notifications']);
    expect(order).toEqual(['localisation', 'notifications', 'session']);
    expect(onError).toHaveBeenCalledWith('notifications', expect.any(Error));
  });

  it('transmet le motif à chaque étape', async () => {
    const seen: SessionEndReason[] = [];
    const end = createSessionEnd([{ name: 'a', run: (reason) => void seen.push(reason) }]);
    await end('expired');
    await end('deleted');
    expect(seen).toEqual(['expired', 'deleted']);
  });

  it('une sortie en cours est partagée : plusieurs refus simultanés ne la lancent qu\'une fois', async () => {
    let release!: () => void;
    const step = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const end = createSessionEnd([{ name: 'a', run: step }]);
    const first = end('expired');
    const second = end('expired');
    expect(second).toBe(first);
    release();
    await first;
    expect(step).toHaveBeenCalledTimes(1);
    // Terminée : une nouvelle sortie repasse les étapes.
    const third = end('logout');
    release();
    await third;
    expect(step).toHaveBeenCalledTimes(2);
  });

  it('seul un refus explicite du jeton de rafraîchissement perd la session', () => {
    for (const status of [400, 401, 403]) expect(isRefreshRefused({ status, code: 'X' })).toBe(true);
    for (const status of [0, 404, 408, 429, 500, 502, 503]) expect(isRefreshRefused({ status, code: 'X' })).toBe(false);
    expect(isRefreshRefused(new Error('inattendue'))).toBe(false);
    expect(isRefreshRefused(null)).toBe(false);
  });
});
