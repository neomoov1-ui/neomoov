CREATE TABLE "platform_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"number" varchar(20) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"gst_cents" integer NOT NULL,
	"qst_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'CAD' NOT NULL,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_method" varchar(10),
	"payment_reference" varchar(120),
	"payment_failure_code" varchar(60),
	"stripe_invoice_id" varchar(100),
	"hosted_invoice_url" text,
	"pdf_key" varchar(300),
	"reminders_sent" smallint DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_invoices_status" CHECK ("platform_invoices"."status" IN ('draft', 'open', 'paid', 'past_due', 'void')),
	CONSTRAINT "platform_invoices_payment_method" CHECK ("platform_invoices"."payment_method" IS NULL OR "platform_invoices"."payment_method" IN ('stripe', 'offline')),
	CONSTRAINT "platform_invoices_amounts" CHECK ("platform_invoices"."subtotal_cents" >= 0 AND "platform_invoices"."gst_cents" >= 0 AND "platform_invoices"."qst_cents" >= 0 AND "platform_invoices"."total_cents" = "platform_invoices"."subtotal_cents" + "platform_invoices"."gst_cents" + "platform_invoices"."qst_cents"),
	CONSTRAINT "platform_invoices_period" CHECK ("platform_invoices"."period_end" > "platform_invoices"."period_start"),
	CONSTRAINT "platform_invoices_reminders" CHECK ("platform_invoices"."reminders_sent" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_code" varchar(40) NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"billing_period" varchar(10) DEFAULT 'monthly' NOT NULL,
	"started_at" timestamp with time zone,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"stripe_customer_id" varchar(100),
	"stripe_subscription_id" varchar(100),
	"active_vehicles" integer DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_status" CHECK ("subscriptions"."status" IN ('trialing', 'active', 'past_due', 'read_only', 'suspended', 'cancelled')),
	CONSTRAINT "subscriptions_billing_period" CHECK ("subscriptions"."billing_period" IN ('monthly', 'annual')),
	CONSTRAINT "subscriptions_period" CHECK ("subscriptions"."current_period_end" > "subscriptions"."current_period_start"),
	CONSTRAINT "subscriptions_active_vehicles" CHECK ("subscriptions"."active_vehicles" >= 0)
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "setup_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "monthly_price_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "annual_price_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "per_active_vehicle_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "included_vehicles" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "currency" varchar(3) DEFAULT 'CAD' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_invoices_number_unique" ON "platform_invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_invoices_stripe_unique" ON "platform_invoices" USING btree ("stripe_invoice_id") WHERE "platform_invoices"."stripe_invoice_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_invoices_period_unique" ON "platform_invoices" USING btree ("subscription_id","period_start") WHERE "platform_invoices"."status" <> 'void';--> statement-breakpoint
CREATE INDEX "platform_invoices_org_idx" ON "platform_invoices" USING btree ("organization_id","issued_at");--> statement-breakpoint
CREATE INDEX "platform_invoices_unpaid_idx" ON "platform_invoices" USING btree ("status","due_at") WHERE "platform_invoices"."status" IN ('open', 'past_due');--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_org_current_unique" ON "subscriptions" USING btree ("organization_id") WHERE "subscriptions"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "subscriptions_renewal_idx" ON "subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_prices" CHECK ("plans"."setup_fee_cents" >= 0 AND "plans"."monthly_price_cents" >= 0 AND "plans"."annual_price_cents" >= 0 AND "plans"."per_active_vehicle_cents" >= 0 AND "plans"."included_vehicles" >= 0);--> statement-breakpoint
-- Étape 25 : isolation par organisation (étape 20). Une organisation lit son abonnement et ses factures (sous-arbre du
-- contexte) mais n'écrit jamais : politique en lecture seule pour le rôle restreint ; les écritures restent à la
-- plateforme (rôle de l'API, hors politiques).
GRANT SELECT, INSERT, UPDATE, DELETE ON "subscriptions" TO neomoov_scoped;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_invoices" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "subscriptions" FOR SELECT TO neomoov_scoped USING (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "platform_invoices" FOR SELECT TO neomoov_scoped USING (app_scope_allows(organization_id));
