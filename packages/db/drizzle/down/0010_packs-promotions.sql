-- Inverse de 0010 : retire le journal des crédits consommés, les colonnes de parrainage, de garantie et R-LuxeEV.
DROP TABLE IF EXISTS credit_uses;--> statement-breakpoint
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_kind;--> statement-breakpoint
DROP INDEX IF EXISTS referrals_code_idx;--> statement-breakpoint
DROP INDEX IF EXISTS referrals_referred_kind_unique;--> statement-breakpoint
DROP INDEX IF EXISTS users_referral_code_unique;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS driver_fare_protected;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS guarantee_outcome;--> statement-breakpoint
ALTER TABLE drivers DROP COLUMN IF EXISTS is_rluxe_ev_tenant;--> statement-breakpoint
ALTER TABLE referrals DROP COLUMN IF EXISTS threshold_rides;--> statement-breakpoint
ALTER TABLE referrals DROP COLUMN IF EXISTS kind;--> statement-breakpoint
ALTER TABLE users DROP COLUMN IF EXISTS referral_code;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS referrals_code_unique ON referrals USING btree (code);
