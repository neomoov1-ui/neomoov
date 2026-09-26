-- Inverse de 0017 : PostgreSQL ne retire pas une valeur d'un type énuméré. On retire les suppléments « pet » ; la valeur
-- reste déclarée dans `surcharge_code`, sans effet (le moteur ne l'applique qu'avec une ligne de supplément active).
DELETE FROM surcharges WHERE code = 'pet';
