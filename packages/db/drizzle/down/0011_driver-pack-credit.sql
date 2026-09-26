-- Inverse de 0011 : rien à retirer. La valeur `credit_origin.driver_pack` reste : PostgreSQL ne sait pas retirer une valeur
-- d'un type énuméré ; le code précédent ne la produit simplement plus.
SELECT 1;
