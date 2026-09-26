/**
 * Relevé d'exemple (prompt 09, vérifications) : semaine fictive calculée par le moteur du domaine, écrite en JSON et en
 * PDF dans `docs/examples/`. Aucune donnée réelle, aucune base : `pnpm --filter @neomoov/api example:statement`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStatement, classifyRideForStatement, isCredit, mulDivRound, packBillingLines, type SettlementRide, type StatementLine, type TaxRates } from '@neomoov/domain';
import { renderStatementPdf } from '../modules/settlement/statement-pdf.js';

const rates: TaxRates = { gstRatePpm: 50_000, qstRatePpm: 99_750 };
const period = { startDate: '2026-09-14', endDate: '2026-09-20', timeZone: 'America/Toronto' };

function ride(n: number, over: Partial<SettlementRide>): SettlementRide & { number: string } {
  const fare = over.fareCents ?? 2_455;
  const subtotal = fare - (over.promotionCompensationCents ?? 0) + 200 + 90 + (over.tollCents ?? 0);
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, number: `NM-2026-09-${14 + (n % 7)}-000${n}`, status: 'completed', completedAt: new Date(`2026-09-${14 + (n % 7)}T${10 + n}:15:00Z`),
    paymentChannel: 'platform', fareCents: fare, serviceFeeCents: 200, regulatoryFeeCents: 90, gstCents: mulDivRound(subtotal, rates.gstRatePpm, 1_000_000), qstCents: mulDivRound(subtotal, rates.qstRatePpm, 1_000_000),
    tipCents: 0, tipChannel: 'platform', promotionCompensationCents: 0, tollCents: 0, cancellationFeeCents: 0, ...over,
  };
}

const rides = [
  ride(1, { tipCents: 400 }),
  ride(2, { fareCents: 3_870 }),
  ride(3, { paymentChannel: 'direct', fareCents: 1_980 }),
  ride(4, { promotionCompensationCents: 2_455 }),
  ride(5, { fareCents: 5_210, tollCents: 350, tipCents: 800 }),
  ride(6, { status: 'no_show', fareCents: 0, serviceFeeCents: 0, regulatoryFeeCents: 0, gstCents: 0, qstCents: 0, cancellationFeeCents: 1_000 }),
];
const lines: StatementLine[] = rides.flatMap((r) => classifyRideForStatement(r, rates).map((l) => ({ ...l, label: `${l.label ?? l.kind} · ${r.number}` })));
lines.push(...packBillingLines('00000000-0000-4000-8000-00000000pack', 5_900, new Date('2026-09-14T13:00:00Z'), rates, 'Pack Essentiel'));
lines.push({ kind: 'adjustment_positive', amountCents: 1_500, occurredAt: new Date('2026-09-20T15:00:00Z'), label: 'Prime de parrainage de lancement' });
const statement = buildStatement('00000000-0000-4000-8000-0000000driver', period, lines);

const detail = {
  id: '00000000-0000-4000-8000-00000statement', driverId: statement.driverId, driverPublicNumber: 'CH-00042', driverName: 'Chauffeur Exemple', periodStart: period.startDate, periodEnd: period.endDate,
  status: 'paid' as const, creditsCents: statement.creditsCents, debitsCents: statement.debitsCents, netCents: statement.netCents, issuedAt: '2026-09-25T10:00:00.000Z', settledAt: '2026-09-25T10:02:00.000Z',
  attempts: 1, failureCode: null, transferRef: 'tr_exemple', chargeRef: null, pdfAvailable: true,
  lines: statement.lines.map((l) => ({ kind: l.kind, label: l.label ?? l.kind, amountCents: isCredit(l.kind) ? l.amountCents : -l.amountCents, rideId: l.rideId ?? null, packPurchaseId: l.packPurchaseId ?? null, occurredAt: l.occurredAt.toISOString() })),
};

const out = resolve(process.argv[2] ?? resolve(process.cwd(), '../../docs/examples'));
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'releve-exemple.json'), `${JSON.stringify({ ...detail, totalsByKind: statement.totalsByKind }, null, 2)}\n`);
writeFileSync(resolve(out, 'releve-exemple.pdf'), await renderStatementPdf(detail, { timeZone: period.timeZone, companyName: 'Neomoov' }));
console.log(`Relevé d'exemple écrit dans ${out} (net ${statement.netCents} cents, ${statement.lines.length} lignes)`);
