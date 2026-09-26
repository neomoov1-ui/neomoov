import { describe, expect, it } from 'vitest';
import { markedPhone, markedPhonePattern, planE2eDataset, SEED_E2E_MARKER, shiftDay, weekAnchor, zonedParts, zonedTime } from '../src/scripts/seed-e2e/plan.js';
import { mapLimit } from '../src/scripts/seed-e2e/runner.js';

const TZ = 'America/Toronto';

describe('jeu de bout en bout : plan déterministe (unitaire)', () => {
  it('même graine et même ancre : même plan ; autre graine : autre plan', () => {
    const a = planE2eDataset({ anchorDay: '2026-09-21' });
    const b = planE2eDataset({ anchorDay: '2026-09-21' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = planE2eDataset({ anchorDay: '2026-09-21', seed: 7 });
    expect(JSON.stringify(c.rides)).not.toBe(JSON.stringify(a.rides));
  });

  it('volumes par défaut : 50 chauffeurs, 200 clients, 300 courses sur 6 semaines, tous marqués et uniques', () => {
    const plan = planE2eDataset({ anchorDay: '2026-09-21' });
    expect(plan.drivers).toHaveLength(50);
    expect(plan.clients).toHaveLength(200);
    expect(plan.rides).toHaveLength(300);
    expect(plan.weeks).toEqual(['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14']);
    const phones = [...plan.drivers, ...plan.clients].map((u) => u.phone);
    expect(new Set(phones).size).toBe(250);
    // 12 chiffres : jamais un téléphone de test (`+1999` et 7 chiffres, 11 chiffres).
    for (const phone of phones) expect(phone).toMatch(/^\+199955\d{6}$/);
    for (const u of [...plan.drivers, ...plan.clients]) if (u.email) expect(u.email.endsWith(`@${SEED_E2E_MARKER.emailDomain}`)).toBe(true);
    expect(new Set(plan.rides.map((r) => r.key)).size).toBe(300);
    expect(new Set(plan.rides.map((r) => r.publicNumber)).size).toBe(300);
    expect(new Set(plan.drivers.map((d) => d.vehicle.plate)).size).toBe(50);
    for (const r of plan.rides) expect(r.publicNumber).toMatch(/^NM-\d{4}-\d{2}-\d{2}-E\d{3}$/);
  });

  it('courses passées : prises en charge dans les semaines couvertes, terminées avant l\'ancre, réservées 2 heures avant au moins', () => {
    const plan = planE2eDataset({ anchorDay: '2026-09-21' });
    const start = zonedTime(plan.weeks[0]!, 0, 0, TZ).getTime();
    for (const r of plan.rides) {
      expect(r.pickupAt.getTime()).toBeGreaterThanOrEqual(start);
      const end = r.pickupAt.getTime() + (r.waitedSeconds + r.durationSeconds) * 1000;
      expect(end).toBeLessThan(plan.anchor.getTime());
      expect(r.pickupAt.getTime() - r.bookedAt.getTime()).toBeGreaterThanOrEqual(2 * 3_600_000);
      expect(r.category).toBe(plan.drivers[r.driverIndex]!.vehicle.category);
      expect(r.origin.address).not.toBe(r.destination.address);
    }
  });

  it('répartition : chaque chauffeur et chaque client a une course, paiements variés, frais d\'annulation et absences, présence dans toutes les zones', () => {
    const plan = planE2eDataset({ anchorDay: '2026-09-21' });
    expect(new Set(plan.rides.map((r) => r.driverIndex)).size).toBe(50);
    expect(new Set(plan.rides.map((r) => r.clientIndex)).size).toBe(200);
    const outcomes = plan.rides.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
    expect(outcomes).toEqual({ completed: 282, no_show: 12, cancelled_by_client: 6 });
    const methods = new Set(plan.rides.map((r) => r.paymentMethod));
    expect(methods).toEqual(new Set(['card_app', 'apple_pay', 'cash', 'interac']));
    // Paiement au chauffeur : seulement par un moyen qu'il accepte ; jamais de pourboire connu sur un paiement direct.
    for (const r of plan.rides.filter((x) => x.paymentChoice === 'pay_driver_after')) {
      const d = plan.drivers[r.driverIndex]!;
      expect(r.paymentMethod === 'cash' ? d.acceptsCash : d.acceptsInterac).toBe(true);
      expect(r.tipCents).toBe(0);
    }
    expect(new Set(plan.drivers.map((d) => d.area))).toEqual(new Set(['centre-ville', 'vieux-montreal', 'plateau', 'yul', 'ailleurs']));
    for (const d of plan.drivers) {
      expect(d.home.lat).toBeGreaterThan(45.4);
      expect(d.home.lat).toBeLessThan(45.72);
      expect(d.home.lng).toBeGreaterThan(-74.05);
      expect(d.home.lng).toBeLessThan(-73.3);
    }
  });

  it('téléphones marqués : format, motif SQL, refus hors bornes', () => {
    expect(markedPhone({ phonePrefix: '+199955' }, 0, 1)).toBe('+199955000001');
    expect(markedPhone({ phonePrefix: '+199956' }, 1, 99_999)).toBe('+199956199999');
    expect(markedPhonePattern({ phonePrefix: '+199955' })).toBe('+199955______');
    expect(() => markedPhone({ phonePrefix: '+15145' }, 0, 1)).toThrow(/Préfixe/);
    expect(() => markedPhone({ phonePrefix: '+199955' }, 10, 1)).toThrow(/Type/);
    expect(() => markedPhone({ phonePrefix: '+199955' }, 0, 100_000)).toThrow(/Rang/);
    expect(() => planE2eDataset({ anchorDay: '2026-09-21', sizes: { drivers: 0 } })).toThrow(/Taille/);
  });

  it('heures de Montréal : ancre au lundi, heure d\'été et heure normale', () => {
    expect(weekAnchor(new Date('2026-09-26T15:00:00Z'), TZ)).toBe('2026-09-21');
    expect(weekAnchor(new Date('2026-09-21T03:59:00Z'), TZ)).toBe('2026-09-14');
    expect(zonedTime('2026-07-01', 8, 30, TZ).toISOString()).toBe('2026-07-01T12:30:00.000Z');
    expect(zonedTime('2026-12-01', 8, 30, TZ).toISOString()).toBe('2026-12-01T13:30:00.000Z');
    expect(zonedParts(new Date('2026-11-01T06:30:00Z'), TZ)).toMatchObject({ day: 1, hour: 1, weekday: 7 });
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('exécution bornée : au plus `limit` traitements à la fois, résultats dans l\'ordre', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, n * 3));
      running -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
  });
});
