/**
 * Redevance Neomoov (décision du fondateur du 3 octobre 2026) : écrite une seule fois par course terminée, dans la
 * transaction de la fin de course (`RidesService.complete`), au taux du chauffeur à ce moment. L'index unique par course
 * rend l'écriture idempotente. Le relevé hebdomadaire en tire la ligne `platform_fee` : retenue sur le versement quand la
 * course est payée par carte, ajoutée à ce que le chauffeur doit quand elle lui est payée directement. Rien à voir avec la
 * redevance gouvernementale (`redevance_ledger`), tenue à part par le module des registres.
 */
import { schema } from '@neomoov/db';
import { computePlatformFee } from '@neomoov/domain';
import { eq } from 'drizzle-orm';
import type { Database } from '../../infra/db.module.js';

type Executor = Pick<Database['db'], 'insert' | 'select'>;

export interface PlatformFeeRide {
  id: string;
  driverId: string | null;
  fareCents: number | null;
  paymentChoice: string | null;
}

/** Écrit la redevance Neomoov d'une course terminée ; sans effet si elle existe déjà ou si la course n'a pas de chauffeur. */
export async function recordPlatformFee(tx: Executor, ride: PlatformFeeRide): Promise<boolean> {
  if (!ride.driverId) return false;
  const [driver] = await tx.select({ rateBps: schema.drivers.platformFeeBps }).from(schema.drivers).where(eq(schema.drivers.id, ride.driverId)).limit(1);
  if (!driver) return false;
  const fee = computePlatformFee({ fareCents: Math.max(0, ride.fareCents ?? 0), rateBps: driver.rateBps });
  const written = await tx
    .insert(schema.platformFees)
    .values({
      rideId: ride.id, driverId: ride.driverId, baseCents: fee.baseCents, rateBps: fee.rateBps, amountCents: fee.amountCents,
      paymentChannel: ride.paymentChoice === 'pay_driver_after' ? 'direct' : 'platform',
    })
    .onConflictDoNothing({ target: schema.platformFees.rideId })
    .returning({ id: schema.platformFees.id });
  return written.length > 0;
}
