/**
 * Revue du 2 octobre 2026, constats web 13, 18, 19 et 20 (finalisation U6) : témoin de profil de My Hub, retour après
 * connexion, chemins relayés vers l'API, documents affichés dans My Hub, fournisseur des tuiles des cartes. Fonctions
 * pures, sans navigateur ni base.
 */
import { describe, expect, it } from 'vitest';
import { documentKind } from '../src/lib/document-kind';
import { hubReturnPath, parseHubUserCookie } from '../src/lib/hub-user-cookie';
import { mapTileConfig, OSM_ATTRIBUTION, OSM_TILE_URL } from '../src/lib/map-tiles';
import { relayTarget } from '../src/lib/server/relay-path';

const ID = '0b5f7c1e-2d3a-4c5b-8e9f-0a1b2c3d4e5f';

describe('témoin de profil de My Hub (constat 18)', () => {
  it('profil bien formé : lu tel quel, champs absents ramenés à null', () => {
    expect(parseHubUserCookie(JSON.stringify({ id: ID, firstName: 'Ana', lastName: null, email: 'ana@neomoov.net', roles: ['admin'] }))).toEqual({ id: ID, firstName: 'Ana', lastName: null, email: 'ana@neomoov.net', roles: ['admin'] });
    expect(parseHubUserCookie(JSON.stringify({ id: ID, roles: [] }))).toEqual({ id: ID, firstName: null, lastName: null, email: null, roles: [] });
  });

  it('absent, illisible ou altéré : aucune session (jamais un profil partiel)', () => {
    for (const raw of [undefined, null, '', 'pas du json', '[]', 'null', '"texte"', JSON.stringify({ roles: ['admin'] }), JSON.stringify({ id: 'admin', roles: ['admin'] }),
      JSON.stringify({ id: ID, roles: 'admin' }), JSON.stringify({ id: ID, roles: [1] }), JSON.stringify({ id: ID, roles: [], email: 42 }), JSON.stringify({ id: ID, roles: [], firstName: { a: 1 } }),
      JSON.stringify({ id: ID, roles: ['x'.repeat(65)] }), `{"id":"${ID}","roles":[],"pad":"${'x'.repeat(5000)}"}`]) {
      expect(parseHubUserCookie(raw)).toBeNull();
    }
  });

  it('retour après connexion : chemin de My Hub gardé, tout le reste ramené à /hub', () => {
    expect(hubReturnPath('/hub/courses/123')).toBe('/hub/courses/123');
    expect(hubReturnPath('/hub')).toBe('/hub');
    expect(hubReturnPath('/hub/connexion')).toBe('/hub');
    expect(hubReturnPath('//exemple.com')).toBe('/hub');
    expect(hubReturnPath('/hub/../reserver')).toBe('/hub');
    expect(hubReturnPath('/reserver')).toBe('/hub');
  });
});

describe('relais /api/v1 de My Hub (constat 19)', () => {
  it('routes du personnel et des organisations relayées', () => {
    expect(relayTarget(['admin', 'rides', ID])).toBe(`admin/rides/${ID}`);
    expect(relayTarget(['admin', 'settings', 'dispatch.requested_sweep_seconds'])).toBe('admin/settings/dispatch.requested_sweep_seconds');
    expect(relayTarget(['admin', 'booster', 'performance', 'export.csv'])).toBe('admin/booster/performance/export.csv');
    expect(relayTarget(['org', ID, 'vehicles'])).toBe(`org/${ID}/vehicles`);
    expect(relayTarget(['me'])).toBe('me');
    expect(relayTarget(['places', 'details'])).toBe('places/details');
  });

  it('segments décodés dangereux refusés, même sous admin/', () => {
    expect(relayTarget(['admin', '..', 'auth', 'refresh'])).toBeNull();
    expect(relayTarget(['admin', '.', 'users'])).toBeNull();
    expect(relayTarget(['admin', 'users/../../auth'])).toBeNull();
    expect(relayTarget(['admin', 'a b'])).toBeNull();
    expect(relayTarget(['admin', 'rides%2F..'])).toBeNull();
    expect(relayTarget(['admin', 'rides?x=1'])).toBeNull();
    expect(relayTarget(['admin', ''])).toBeNull();
    expect(relayTarget(['org', '..', 'admin', 'users'])).toBeNull();
  });

  it('hors liste blanche : refusé', () => {
    expect(relayTarget([])).toBeNull();
    expect(relayTarget(undefined)).toBeNull();
    expect(relayTarget(['auth', 'refresh'])).toBeNull();
    expect(relayTarget(['rides', ID, 'cancel'])).toBeNull();
    expect(relayTarget(['org', 'pas-un-uuid', 'vehicles'])).toBeNull();
    expect(relayTarget(['admin'])).toBeNull();
  });
});

describe('documents des chauffeurs dans My Hub (constat 20)', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  it('PDF affiché seulement si le type ET les premiers octets concordent', () => {
    expect(documentKind('application/pdf', bytes('%PDF-1.7'))).toBe('pdf');
    expect(documentKind('application/pdf', bytes('<html><script>'))).toBe('download');
    expect(documentKind('application/pdf', new Uint8Array())).toBe('download');
    expect(documentKind('text/html', bytes('%PDF-1.7'))).toBe('download');
  });

  it('images matricielles affichées, tout le reste téléchargé', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) expect(documentKind(type, new Uint8Array())).toBe('image');
    for (const type of ['image/svg+xml', 'text/html', 'application/octet-stream', '']) expect(documentKind(type, new Uint8Array())).toBe('download');
  });
});

describe('tuiles des cartes (constat 13)', () => {
  it('sans variable, ou avec une valeur invalide : OpenStreetMap', () => {
    expect(mapTileConfig(undefined, undefined)).toEqual({ url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION });
    expect(mapTileConfig('http://tuiles.exemple/{z}/{x}/{y}.png', 'X')).toEqual({ url: OSM_TILE_URL, attribution: OSM_ATTRIBUTION });
    expect(mapTileConfig('https://tuiles.exemple/carte.png', 'X').url).toBe(OSM_TILE_URL);
    expect(mapTileConfig('javascript:alert(1)//{z}{x}{y}', 'X').url).toBe(OSM_TILE_URL);
  });

  it('fournisseur configuré : gabarit et mention retenus (mention OSM par défaut si absente)', () => {
    const url = 'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=cle-publique';
    expect(mapTileConfig(` ${url} `, '© MapTiler © OpenStreetMap')).toEqual({ url, attribution: '© MapTiler © OpenStreetMap' });
    expect(mapTileConfig(url, '  ').attribution).toBe(OSM_ATTRIBUTION);
  });
});
