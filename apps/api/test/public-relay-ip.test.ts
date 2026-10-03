import { describe, expect, it } from 'vitest';
import { relayedVisitorIp } from '../src/modules/public/public-api.controller.js';

describe('relais public : adresse du visiteur transmise par un site partenaire', () => {
  it('adresses IPv4 et IPv6 valides seulement, sinon null', () => {
    expect(relayedVisitorIp('203.0.113.7')).toBe('203.0.113.7');
    expect(relayedVisitorIp(' 2001:db8::1 ')).toBe('2001:db8::1');
    expect(relayedVisitorIp(undefined)).toBeNull();
    expect(relayedVisitorIp('')).toBeNull();
    expect(relayedVisitorIp('203.0.113.7, 10.0.0.1')).toBeNull();
    expect(relayedVisitorIp('<script>')).toBeNull();
  });
});
