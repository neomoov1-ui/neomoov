-- Inverse de 0006 : retire les résultats de formation, les compteurs journaliers du tableau de conduite et les colonnes du profil chauffeur.
DROP TABLE IF EXISTS driver_training_results;--> statement-breakpoint
ALTER TABLE driver_scores DROP COLUMN IF EXISTS punctual_rides;--> statement-breakpoint
ALTER TABLE driver_scores DROP COLUMN IF EXISTS timed_rides;--> statement-breakpoint
ALTER TABLE driver_scores DROP COLUMN IF EXISTS completed_rides;--> statement-breakpoint
ALTER TABLE driver_scores DROP COLUMN IF EXISTS distance_meters;--> statement-breakpoint
ALTER TABLE drivers DROP COLUMN IF EXISTS training_certified_at;--> statement-breakpoint
ALTER TABLE drivers DROP COLUMN IF EXISTS experience_years;--> statement-breakpoint
ALTER TABLE drivers DROP COLUMN IF EXISTS spoken_languages;
