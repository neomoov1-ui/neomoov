-- Inverse de 0018 : retire l'exclusion des notes par une personne (Charte d'équité).
ALTER TABLE ride_ratings DROP COLUMN excluded_by_user_id;
ALTER TABLE ride_ratings DROP COLUMN excluded_reason;
ALTER TABLE ride_ratings DROP COLUMN excluded_at;
