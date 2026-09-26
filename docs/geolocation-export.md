# Export mensuel de géolocalisation (format provisoire)

Section 5.13 du cahier des charges : « Export des données de géolocalisation exigées par le ministère : tâche mensuelle produisant le fichier au format demandé (à préciser avec la CTQ), archivé et daté. » Le format décrit ici (`csv-v0`) est **provisoire** : il sera confirmé ou remplacé après échange avec la Commission des transports du Québec (CTQ). Code : `apps/api/src/modules/ledgers/geolocation-format.ts` et `geolocation-export.service.ts`.

## Production

- **Tâche mensuelle.** Une passe horaire (file `exports` du worker) produit l'export du mois précédent dès le 1er du mois, à partir de 00 h, heure de Montréal (`service.time_zone`). Si le worker était arrêté le 1er, la passe suivante rattrape le mois manquant. Un mois déjà exporté au format en vigueur n'est pas refait par la tâche.
- **Lancement manuel.** My Hub (Registres et exports) ou `POST /v1/admin/geolocation-exports` avec `{ "month": "AAAA-MM" }`, pour un mois terminé seulement. Le fichier du mois est remplacé (nouveau nom, daté) ; l'ancien fichier reste archivé dans le stockage. Un export déjà transmis (`transmitted_at` renseigné) n'est jamais remplacé.
- **Archivage.** Stockage objet (`StorageProvider`, Supabase Storage en production, D49), clé `geolocation/<format>/neomoov-geolocalisation-<AAAA-MM>-<AAAAMMJJTHHMMSSZ>.csv` : le mois couvert et l'instant de production (UTC) sont dans le nom.
- **Registre.** Une ligne `geolocation_exports` par mois et par format (index unique sur la période et le format) : période, format, fichier, nombre de courses, date de production (`created_at`), transmission et accusé (colonnes prêtes, renseignées quand la transmission sera définie). Deux productions simultanées du même mois sont empêchées par un verrou consultatif PostgreSQL.
- **Téléchargement.** `GET /v1/admin/geolocation-exports/{id}/file`, personnel des finances et administrateurs, journalisé (`geolocation.export_downloaded`).

## Périmètre

Toutes les courses **terminées** (états `completed`, `rated`, `disputed`) dont la fin de course tombe dans le mois, heure de Montréal. Les courses annulées, sans chauffeur ou non présentées n'y figurent pas (à confirmer avec la CTQ).

## Format `csv-v0`

UTF-8 sans BOM, séparateur virgule, fins de ligne CRLF, une ligne d'en-tête, une ligne par course, triées par fin de course.

| Colonne | Contenu |
|---|---|
| `trajet` | Pseudonyme de la course (32 caractères hexadécimaux) |
| `chauffeur` | Pseudonyme du chauffeur |
| `vehicule` | Pseudonyme du véhicule |
| `categorie` | Catégorie servie (`neo_premium`, `neo_prestige`, `neo_xl`, `neo_limo`) |
| `origine_lat`, `origine_lng` | Point de départ, WGS 84, degrés décimaux arrondis à 3 décimales |
| `destination_lat`, `destination_lng` | Point d'arrivée, même arrondi |
| `prise_en_charge_utc` | Début de la course (état `in_progress`), ISO 8601 UTC à la seconde |
| `arrivee_utc` | Fin de la course, ISO 8601 UTC à la seconde |
| `distance_m` | Distance en mètres : mesurée sur la trace GPS quand elle existe, sinon celle de l'itinéraire |
| `duree_s` | Durée en secondes, même source |

Exemple (valeurs fictives) :

```
trajet,chauffeur,vehicule,categorie,origine_lat,origine_lng,destination_lat,destination_lng,prise_en_charge_utc,arrivee_utc,distance_m,duree_s
6f1c0e7a9b2d4c3e8f5a1b2c3d4e5f60,0a9b8c7d6e5f40312a3b4c5d6e7f8091,5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b,neo_premium,45.523,-73.582,45.5,-73.568,2026-09-15T14:40:00Z,2026-09-15T15:00:00Z,8200,1100
```

## Protection des renseignements personnels (Loi 25)

- **Aucun identifiant réel** : ni identifiant interne, ni numéro public de course ou de chauffeur, ni nom, téléphone, adresse ou plaque. Le test d'intégration vérifie que le fichier n'en contient aucun.
- **Pseudonymes stables** : HMAC-SHA256 tronqué à 128 bits de `<nature>:<identifiant>`, avec une clé dérivée par HKDF-SHA256 de `ENCRYPTION_KEY` (sel `neomoov`, étiquette `neomoov/geolocation-export/v1`), jamais la clé brute. Le même chauffeur a le même pseudonyme d'un mois à l'autre ; sans la clé, le pseudonyme ne se relie pas à la personne. Changer `ENCRYPTION_KEY` ou l'étiquette change tous les pseudonymes : à éviter entre deux exports, ou à annoncer à la CTQ.
- **Coordonnées arrondies** à 3 décimales (environ 110 m en latitude et 80 m en longitude à Montréal) : minimisation par défaut, suffisante pour une matrice origine et destination. À augmenter seulement si la CTQ l'exige.

## Points à confirmer avec la CTQ

1. Format du fichier (CSV, JSON, XML, gabarit imposé), encodage, séparateur, nom de fichier.
2. Champs exigés : faut-il les trajets à vide, l'attente, le nombre de passagers, le type de service, les zones, les courses annulées ?
3. Précision des coordonnées et forme des identifiants (pseudonymes acceptés, stables d'un mois à l'autre ?).
4. Fuseau et forme des horodatages (UTC ou heure locale).
5. Mode et délai de transmission (portail, SFTP, API), accusé de réception, durée de conservation des fichiers.

## Ajouter ou changer de format

Nouveau format = nouveau code dans `GEOLOCATION_FORMATS` (par exemple `csv-v1`), puis le réglage `geolocation_export.format` dans My Hub (Paramètres). Les exports déjà produits gardent leur format d'origine : la table garde une ligne par mois **et** par format.
