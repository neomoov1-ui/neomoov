import { describe, expect, it } from 'vitest';
import { SETTINGS } from '../src/seed/data.js';
import { seedDemoByDefault } from '../src/seed/index.js';

describe('données de départ', () => {
  it('comptes de démonstration : jamais en production par défaut, forçables', () => {
    expect(seedDemoByDefault({ NODE_ENV: 'production' })).toBe(false);
    expect(seedDemoByDefault({ NODE_ENV: 'development' })).toBe(true);
    expect(seedDemoByDefault({})).toBe(true);
    expect(seedDemoByDefault({ NODE_ENV: 'production', SEED_DEMO: 'on' })).toBe(true);
    expect(seedDemoByDefault({ NODE_ENV: 'development', SEED_DEMO: 'off' })).toBe(false);
  });

  it('coordonnées de l\'assistance présentes (vides) pour être réglées dans My Hub', () => {
    const keys = new Set(SETTINGS.map((s) => s.key));
    expect(keys.has('support.phone') && keys.has('support.email')).toBe(true);
  });
});
