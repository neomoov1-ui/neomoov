-- Inverse de 0014 : remet les longueurs d'origine. À n'exécuter qu'après avoir remis les valeurs en clair
-- (`pnpm --filter @neomoov/api fields:encrypt -- --decrypt`) : une valeur chiffrée ne tient pas en 20 ou 60 caractères.
ALTER TABLE drivers ALTER COLUMN qst_number SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE drivers ALTER COLUMN gst_number SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE driver_documents ALTER COLUMN number SET DATA TYPE varchar(60);
