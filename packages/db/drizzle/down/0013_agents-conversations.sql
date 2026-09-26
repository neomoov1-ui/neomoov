-- Inverse de 0013 : retire les conversations, les prompts versionnés, les colonnes ajoutées aux exécutions et aux
-- approbations, et la valeur `skipped` des statuts d'exécution (PostgreSQL ne retire pas une valeur d'énumération : le
-- type est recréé sans elle, après conversion des lignes qui l'utilisent). Les agents reviennent au modèle précédent.
DROP TABLE IF EXISTS conversation_messages;--> statement-breakpoint
DROP TABLE IF EXISTS conversations;--> statement-breakpoint
DROP TABLE IF EXISTS agent_prompts;--> statement-breakpoint
DROP INDEX IF EXISTS agent_runs_trigger_uq;--> statement-breakpoint
DROP INDEX IF EXISTS agent_runs_started_idx;--> statement-breakpoint
DROP INDEX IF EXISTS approvals_run_idx;--> statement-breakpoint
ALTER TABLE agent_runs DROP COLUMN IF EXISTS cache_read_tokens;--> statement-breakpoint
ALTER TABLE agent_runs DROP COLUMN IF EXISTS cache_write_tokens;--> statement-breakpoint
ALTER TABLE agent_runs DROP COLUMN IF EXISTS model;--> statement-breakpoint
ALTER TABLE approvals DROP COLUMN IF EXISTS decision_note;--> statement-breakpoint
ALTER TABLE approvals DROP COLUMN IF EXISTS executed_at;--> statement-breakpoint
ALTER TABLE approvals DROP COLUMN IF EXISTS execution_result;--> statement-breakpoint
ALTER TABLE approvals DROP COLUMN IF EXISTS execution_error;--> statement-breakpoint
UPDATE agents SET effort = 'high' WHERE effort IN ('xhigh', 'max');--> statement-breakpoint
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_effort;--> statement-breakpoint
ALTER TABLE agents ADD CONSTRAINT agents_effort CHECK (effort IN ('low', 'medium', 'high'));--> statement-breakpoint
UPDATE agents SET model = 'claude-opus-5' WHERE model = 'claude-opus-5-5';--> statement-breakpoint
ALTER TABLE agents ALTER COLUMN model SET DEFAULT 'claude-opus-5';--> statement-breakpoint
UPDATE agent_runs SET status = 'failed', error = COALESCE(error, 'skipped') WHERE status = 'skipped';--> statement-breakpoint
DROP INDEX IF EXISTS agent_runs_status_idx;--> statement-breakpoint
ALTER TYPE agent_run_status RENAME TO agent_run_status_old;--> statement-breakpoint
CREATE TYPE agent_run_status AS ENUM ('running', 'succeeded', 'failed', 'awaiting_approval');--> statement-breakpoint
ALTER TABLE agent_runs ALTER COLUMN status DROP DEFAULT;--> statement-breakpoint
ALTER TABLE agent_runs ALTER COLUMN status TYPE agent_run_status USING status::text::agent_run_status;--> statement-breakpoint
ALTER TABLE agent_runs ALTER COLUMN status SET DEFAULT 'running';--> statement-breakpoint
CREATE INDEX agent_runs_status_idx ON agent_runs USING btree (status) WHERE status IN ('running', 'awaiting_approval');--> statement-breakpoint
DROP TYPE agent_run_status_old;
