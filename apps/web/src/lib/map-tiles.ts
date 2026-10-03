/**
 * Fournisseur des tuiles des cartes du web (suivi partagé, flotte et zones de My Hub). Revue du 2 octobre 2026 (constat
 * web 13) : les serveurs de tuiles d'OpenStreetMap ne sont pas faits pour un usage commercial soutenu ; le fournisseur
 * se choisit par deux variables publiques, figées au build (`apps/web/Dockerfile`, `infra/compose.prod.yml`, variables
 * GitHub du flux Images) :
 * - `NEXT_PUBLIC_MAP_TILE_URL` : gabarit Leaflet en `https://` avec `{z}`, `{x}` et `{y}` (MapTiler, Stadia,
 *   Thunderforest ou serveur de Neomoov ; la clé publique du fournisseur, limitée aux domaines de Neomoov, y figure) ;
 * - `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` : mention exigée par le fournisseur (HTML court).
 * Absentes ou invalides : OpenStreetMap, comme en développement. Le choix du fournisseur revient au fondateur
 * (`docs/decisions.md`, « À trancher »). Les images de tuiles passent déjà par `img-src https:` de la politique de
 * sécurité du contenu : aucun en-tête à changer pour un fournisseur en `https://`.
 */

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export interface MapTileConfig {
  url: string;
  attribution: string;
}

/** Configuration retenue pour des valeurs données (pure, testée) : gabarit https avec {z}, {x} et {y}, sinon OSM. */
export function mapTileConfig(url: string | undefined, attribution: string | undefined): MapTileConfig {
  const candidate = url?.trim() ?? '';
  const valid = /^https:\/\/[^\s"'<>]+$/.test(candidate) && ['{z}', '{x}', '{y}'].every((p) => candidate.includes(p));
  if (!valid) return { url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION };
  return { url: candidate, attribution: attribution?.trim() || OSM_ATTRIBUTION };
}

/** Configuration du build (variables inscrites dans le bundle par Next.js). */
export const MAP_TILES: MapTileConfig = mapTileConfig(process.env['NEXT_PUBLIC_MAP_TILE_URL'], process.env['NEXT_PUBLIC_MAP_TILE_ATTRIBUTION']);
