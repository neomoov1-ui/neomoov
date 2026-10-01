/**
 * Marque de la requête, côté serveur Next.js seulement (étape 22) : l'hôte de la requête est cherché parmi les domaines
 * vérifiés des organisations (`GET /v1/public/brand?domain=`), résultat gardé 60 secondes par hôte (succès comme
 * échec). Hôte inconnu, `localhost`, adresse IP ou API indisponible : la marque Neomoov.
 */
import { NEOMOOV_BRAND, publicBrandSchema, type Brand, type PublicBrand } from '@neomoov/domain';
import { headers } from 'next/headers';
import { requestHost } from '../brand';
import { API_URL } from './gateway';

const TTL_MS = 60_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; value: PublicBrand | null }>();

async function fetchPublicBrand(query: { domain: string } | { code: string }): Promise<PublicBrand | null> {
  const key = 'domain' in query ? `domain:${query.domain}` : `code:${query.code}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: PublicBrand | null = null;
  try {
    // La clé publique du serveur web l'identifie auprès de l'API (pas de limite par adresse pour ce relais).
    const apiKey = process.env['NEOMOOV_PUBLIC_API_KEY'];
    const search = new URLSearchParams('domain' in query ? { domain: query.domain } : { code: query.code });
    const res = await fetch(`${API_URL}/v1/public/brand?${search.toString()}`, {
      headers: { accept: 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      const parsed = publicBrandSchema.safeParse(await res.json());
      if (parsed.success) value = parsed.data;
    }
  } catch {
    // API indisponible : la marque Neomoov s'applique, la page reste servie.
  }
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Marque d'un hôte (domaine vérifié d'une organisation), sinon Neomoov. */
export async function brandForHost(host: string | null): Promise<Brand> {
  if (!host) return NEOMOOV_BRAND;
  return (await fetchPublicBrand({ domain: host }))?.brand ?? NEOMOOV_BRAND;
}

/** Organisation et marque d'un code de rattachement (page `/c/<code>`), ou `null`. */
export async function brandForCode(code: string): Promise<PublicBrand | null> {
  return fetchPublicBrand({ code });
}

/** Marque de la requête en cours (mise en page, métadonnées des pages publiques et de la connexion à My Hub). */
export async function currentBrand(): Promise<Brand> {
  const h = await headers();
  return brandForHost(requestHost(h.get('x-forwarded-host'), h.get('host')));
}
