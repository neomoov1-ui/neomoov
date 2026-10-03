import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { MockBillingProvider } from '../src/adapters/mock/billing.mock.js';
import type { Database } from '../src/infra/db.module.js';
import { AccessService } from '../src/modules/auth/access.service.js';
import type { UserActor } from '../src/modules/auth/actor.js';
import { renderNotification } from '../src/modules/notifications/templates.js';
import { ACTS_ON_KEY, ActsOnPlace, ActsOnQuote, ActsOnRide, ORG_WRITE_EXEMPT_KEY, OrgWriteExempt } from '../src/modules/organizations/org-request-gates.js';

/**
 * Finalisation du 3 octobre 2026 (agent U2), sans base : tenues conditionnées des permissions dans une organisation,
 * décorateurs de la garde, gabarits des nouveaux avis, portail client simulé.
 */
function fakeDatabase(state: { rows: unknown[]; features: unknown[] }): Database {
  let calls = 0;
  const chain = (result: () => unknown[]): unknown =>
    new Proxy({}, { get: (_target, prop) => (prop === 'then' ? (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(result()).then(resolve, reject) : () => chain(result)) });
  return { db: { select: () => chain(calls++ % 2 === 0 ? () => state.rows : () => state.features) } } as unknown as Database;
}

describe('droits dans une organisation : tenues et conditions des rôles', () => {
  const actor: UserActor = { kind: 'user', userId: 'u1', sessionId: 's1', primaryRole: 'client', roles: [], amr: ['otp'] };
  const row = (membershipId: string, permission: string, conditions: unknown) => ({ membershipId, status: 'active', expiresAt: null, scope: 'organization', path: '/r/a/', permission, conditions });

  it('une tenue par adhésion, conditions lues, condition illisible ignorée (refus par défaut)', async () => {
    const access = new AccessService(fakeDatabase({
      rows: [
        row('m1', 'rides.create', { maxAmountCents: 5000 }), row('m2', 'rides.create', {}), row('m1', 'rides.cancel', { readOnly: true }),
        row('m1', 'rides.assign', { inconnu: 1 }), row('m1', 'members.manage', {}),
      ],
      features: [],
    }));
    const { permissions, grants } = await access.grantsIn(actor, '/r/a/');
    expect([...permissions].sort()).toEqual(['rides.cancel', 'rides.create']);
    expect(grants.get('rides.create')).toEqual([{ maxAmountCents: 5000 }, null]);
    expect(grants.get('rides.cancel')).toEqual([{ readOnly: true }]);
    expect(grants.has('rides.assign')).toBe(false);
    // Sensible sans double authentification : absente ; `permissionsIn` rend la même liste (cache commun).
    expect(grants.has('members.manage')).toBe(false);
    expect([...(await access.permissionsIn(actor, '/r/a/'))].sort()).toEqual(['rides.cancel', 'rides.create']);
  });
});

describe('garde des organisations : décorateurs de l\'objet de l\'action et des écritures de régularisation', () => {
  it('métadonnées posées', () => {
    class Sample {
      @ActsOnRide()
      ride() {}
      @ActsOnQuote()
      quote() {}
      @ActsOnPlace('pickup')
      place() {}
      @OrgWriteExempt()
      exempt() {}
    }
    expect(Reflect.getMetadata(ACTS_ON_KEY, Sample.prototype.ride)).toEqual({ ride: 'id' });
    expect(Reflect.getMetadata(ACTS_ON_KEY, Sample.prototype.quote)).toEqual({ quote: 'quoteId' });
    expect(Reflect.getMetadata(ACTS_ON_KEY, Sample.prototype.place)).toEqual({ place: 'pickup' });
    expect(Reflect.getMetadata(ORG_WRITE_EXEMPT_KEY, Sample.prototype.exempt)).toBe(true);
  });
});

describe('gabarits des avis des organisations', () => {
  it('permission sensible utilisée : auteur, organisation, permissions, en français et en anglais', () => {
    const data = { organizationName: 'Taxi Exemple', actorName: 'Alex Martin', permissions: ['members.manage'], labels: ['Changer le rôle d\'un membre, le suspendre ou le retirer'], at: '2026-10-03T14:00:00Z' };
    const fr = renderNotification('organization.sensitive_permission_used', data, 'fr');
    expect(fr.title).toBe('Action sensible dans Taxi Exemple');
    expect(fr.body).toContain('Alex Martin a utilisé une permission sensible dans Taxi Exemple');
    expect(fr.body).toContain('Changer le rôle d\'un membre');
    const en = renderNotification('organization.sensitive_permission_used', data, 'en');
    expect(en.body).toContain('members.manage');
  });

  it('relevé des échéances de la flotte', () => {
    const fr = renderNotification('fleet.compliance_digest', { organizationName: 'Flotte Nord', days: 14, documents: 2, inspections: 1, overdue: 1, maintenance: 3 }, 'fr');
    expect(fr.title).toBe('Échéances de la flotte Flotte Nord');
    expect(fr.body).toBe('Dans les 14 prochains jours : 2 document(s) de chauffeur, 1 vérification(s) ou inspection(s) de véhicule, dont 1 déjà en retard ; 3 entretien(s) à prévoir. Détail dans My Hub, Flotte, Échéances.');
    expect(renderNotification('fleet.compliance_digest', { days: 7, documents: 1, inspections: 0, overdue: 0, maintenance: 0 }, 'en').body).toBe('In the next 7 days: 1 driver document(s), 0 vehicle check(s) or inspection(s). Details in My Hub, Fleet, Deadlines.');
  });
});

describe('portail client de la facturation (simulé)', () => {
  it('lien pour un client connu, panne simulée, client inconnu refusé', async () => {
    const provider = new MockBillingProvider();
    const { customerId } = await provider.createCustomer({ organizationId: '018f3c1e-0000-7000-8000-0000000000aa', name: 'Org', email: null, language: 'fr' });
    const session = await provider.createPortalSession(customerId, 'https://hub.exemple.test/hub/organisation');
    expect(session.url).toContain('https://billing.stripe.mock/p/session/');
    expect(session.url).toContain(encodeURIComponent('https://hub.exemple.test/hub/organisation'));
    await expect(provider.createPortalSession('cus_inconnu', 'https://hub.exemple.test/hub')).rejects.toMatchObject({ code: 'BILLING_PROVIDER_ERROR' });
    provider.unavailable = true;
    await expect(provider.createPortalSession(customerId, 'https://hub.exemple.test/hub')).rejects.toMatchObject({ status: 502 });
  });
});
