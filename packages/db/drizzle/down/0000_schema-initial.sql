-- Inverse de 0000 : supprime tout le schéma applicatif (toutes les données sont perdues) ; les extensions restent.
DROP SCHEMA public CASCADE;--> statement-breakpoint
CREATE SCHEMA public;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;