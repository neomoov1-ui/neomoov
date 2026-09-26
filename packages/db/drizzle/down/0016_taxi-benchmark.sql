-- Inverse de 0016 : retire la référence taxi de la veille prix (supprimer d'abord les relevés sans prix Uber ni Lyft).
ALTER TABLE competitor_benchmarks DROP CONSTRAINT competitor_benchmarks_price;
DELETE FROM competitor_benchmarks WHERE uber_price_cents IS NULL AND lyft_price_cents IS NULL;
ALTER TABLE competitor_benchmarks DROP COLUMN taxi_price_cents;
ALTER TABLE competitor_benchmarks ADD CONSTRAINT competitor_benchmarks_price CHECK (uber_price_cents IS NOT NULL OR lyft_price_cents IS NOT NULL);
