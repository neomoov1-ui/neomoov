CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope" varchar(12) DEFAULT 'organization' NOT NULL,
	"email" varchar(200),
	"phone" varchar(20),
	"token_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"invited_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_contact" CHECK ("invitations"."email" IS NOT NULL OR "invitations"."phone" IS NOT NULL),
	CONSTRAINT "invitations_scope" CHECK ("invitations"."scope" IN ('organization', 'subtree'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope" varchar(12) DEFAULT 'organization' NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"invited_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_scope" CHECK ("memberships"."scope" IN ('organization', 'subtree')),
	CONSTRAINT "memberships_status" CHECK ("memberships"."status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "organization_features" (
	"organization_id" uuid NOT NULL,
	"module" varchar(20) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" varchar(12) DEFAULT 'plan' NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "organization_features_organization_id_module_pk" PRIMARY KEY("organization_id","module"),
	CONSTRAINT "organization_features_source" CHECK ("organization_features"."source" IN ('plan', 'option', 'override'))
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"code" varchar(60) PRIMARY KEY NOT NULL,
	"module" varchar(20) NOT NULL,
	"description" text NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"platform_only" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"code" varchar(40) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_code" varchar(60) NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_code_pk" PRIMARY KEY("role_id","permission_code")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"code" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"level" smallint NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_level" CHECK ("roles"."level" BETWEEN 0 AND 4)
);
--> statement-breakpoint
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_type";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "path" text;--> statement-breakpoint
-- La racine (plateforme) a le chemin de son identifiant ; toute autre organisation existante devient son enfant.
UPDATE "organizations" SET "path" = '/' || "id" || '/' WHERE "type" = 'platform';--> statement-breakpoint
UPDATE "organizations" o SET "parent_id" = r."id", "path" = r."path" || o."id" || '/' FROM "organizations" r WHERE r."code" = 'neomoov' AND o."path" IS NULL;--> statement-breakpoint
UPDATE "organizations" SET "path" = '/' || "id" || '/' WHERE "path" IS NULL;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "path" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "status" varchar(12) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan_code" varchar(40);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "legal_name" varchar(200);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "gst_number" varchar(30);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "qst_number" varchar(30);--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_features" ADD CONSTRAINT "organization_features_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_unique" ON "memberships" USING btree ("user_id","organization_id","role_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_org_idx" ON "memberships" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_system_code_unique" ON "roles" USING btree ("code") WHERE "roles"."organization_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_code_unique" ON "roles" USING btree ("organization_id","code") WHERE "roles"."organization_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parent_id_organizations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_path_unique" ON "organizations" USING btree ("path");--> statement-breakpoint
CREATE INDEX "organizations_parent_idx" ON "organizations" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_status" CHECK ("organizations"."status" IN ('trial', 'active', 'read_only', 'suspended', 'closed'));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_type" CHECK ("organizations"."type" IN ('platform', 'fleet', 'taxi_company', 'vtc_company', 'business', 'establishment', 'solo', 'sub_org', 'white_label'));