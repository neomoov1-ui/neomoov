ALTER TABLE "drivers" ADD COLUMN "stripe_debit_card_brand" varchar(30);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "stripe_debit_card_last4" varchar(4);