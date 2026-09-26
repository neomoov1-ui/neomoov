import { describe, expect, it } from 'vitest';
import { presignGet, S3StorageProvider, signRequest } from '../src/adapters/real/s3.js';

// Exemples publiés dans la documentation d'Amazon S3 (Signature Version 4) : mêmes clés fictives, mêmes signatures.
const EXAMPLE = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', now: new Date('2013-05-24T00:00:00Z') };
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('stockage objet S3 (signature AWS v4)', () => {
  it('en-tête Authorization : exemple « GET Object » de la documentation', () => {
    const auth = signRequest({
      ...EXAMPLE, method: 'GET', path: '/test.txt', payloadHash: EMPTY,
      headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY, 'x-amz-date': '20130524T000000Z' },
    });
    expect(auth).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });

  it('adresse signée : exemple de la documentation (24 heures)', () => {
    const url = presignGet({ ...EXAMPLE, url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), expiresInSeconds: 86_400 });
    expect(url).toBe('https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  });

  it('dépôt, lecture, absence, suppression, erreurs : adresses en chemin (Supabase) et requêtes signées', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const stored = new Map<string, { body: Buffer; type: string }>();
    const fake = (async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string>;
      calls.push({ url, method: init?.method ?? 'GET', headers });
      const key = new URL(url).pathname;
      if (init?.method === 'PUT') {
        stored.set(key, { body: Buffer.from(init.body as Uint8Array), type: headers['content-type']! });
        return new Response(null, { status: 200 });
      }
      if (init?.method === 'DELETE') return new Response(null, { status: stored.delete(key) ? 204 : 404 });
      const hit = stored.get(key);
      if (!hit) return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 400 });
      return new Response(new Uint8Array(hit.body), { status: 200, headers: { 'content-type': hit.type } });
    }) as typeof fetch;
    const s3 = new S3StorageProvider({ endpoint: 'https://projet.supabase.co/storage/v1/s3/', region: 'ca-central-1', bucket: 'documents', accessKeyId: 'cle', secretAccessKey: 'secret' }, fake);
    await s3.putObject({ key: 'drivers/abc/permis 1.jpg', body: Buffer.from('JPEG'), contentType: 'image/jpeg' });
    expect(calls[0]!.url).toBe('https://projet.supabase.co/storage/v1/s3/documents/drivers/abc/permis%201.jpg');
    expect(calls[0]!.headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=cle\/\d{8}\/ca-central-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(calls[0]!.headers['authorization']).not.toContain('secret');
    expect(await s3.getObject('drivers/abc/permis 1.jpg')).toEqual({ body: Buffer.from('JPEG'), contentType: 'image/jpeg' });
    expect(await s3.getObject('absent.pdf')).toBeNull();
    await s3.deleteObject('drivers/abc/permis 1.jpg');
    await s3.deleteObject('drivers/abc/permis 1.jpg');
    const signed = await s3.getSignedUrl('releves/2026/r.pdf', 600);
    expect(signed).toMatch(/^https:\/\/projet\.supabase\.co\/storage\/v1\/s3\/documents\/releves\/2026\/r\.pdf\?X-Amz-Algorithm=AWS4-HMAC-SHA256&.*X-Amz-Expires=600&.*X-Amz-Signature=[0-9a-f]{64}$/);

    const refusing = new S3StorageProvider({ endpoint: 'https://x', region: 'auto', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' }, (async () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })) as typeof fetch);
    await expect(refusing.putObject({ key: 'k', body: Buffer.from('x'), contentType: 'text/plain' })).rejects.toMatchObject({ code: 'STORAGE_ERROR', status: 502 });
    const down = new S3StorageProvider({ endpoint: 'https://x', region: 'auto', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' }, (async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
    await expect(down.getObject('k')).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });

  it('adresse de style hôte virtuel (AWS)', () => {
    const s3 = new S3StorageProvider({ endpoint: 'https://s3.ca-central-1.amazonaws.com', region: 'ca-central-1', bucket: 'neomoov', accessKeyId: 'a', secretAccessKey: 's', pathStyle: false });
    expect(s3.objectUrl('a/b.pdf').toString()).toBe('https://neomoov.s3.ca-central-1.amazonaws.com/a/b.pdf');
  });
});
