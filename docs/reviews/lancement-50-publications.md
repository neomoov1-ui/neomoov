# Les 50 premières publications de Neomoov (agent S3, 3 octobre 2026)

Branche `lancement-50-publications` (copie `neomoov-wt25b`), créée depuis `origin/main` (`bf3a1ff`). Mission : `neomoov-outils/agents/S3-50-publications.md`, avec `S-COMMUN-reseaux.md` et `COMMUN-2026-10-03.md`. Travail de rédaction : aucune migration, aucune base, aucune compilation, aucun déploiement, aucun compte externe.

## Livrables

| Fichier | Contenu |
|---|---|
| `docs/marketing/lancement-50-publications.json` | Fichier d'import de My Hub, au format `docs/marketing/lancement-50-publications.schema.json` de l'agent S2 (campagne `lancement-2026-10`, `startDate` 2026-10-06, `day` 1 à 28, une variante par réseau, `photoHints`, `sensitive`, `notes` avec l'indication de photo réelle et la date proposée) |
| `docs/marketing/lancement-50-publications.md` | Lecture humaine : tableau des 50 publications (date, thème, sujet, réseaux, photo, approbation), créneaux, puis chaque publication réseau par réseau avec l'heure proposée, le titre d'image et le texte tel qu'il sera publié (lien et mots-clics compris) |
| `scripts/publications-lancement/lot-1.mjs` à `lot-5.mjs` | Sources rédigées (10 publications par lot), seule chose à modifier pour corriger un texte |
| `scripts/construire-publications.mjs` | Construit le JSON et le document de lecture ; `--debut=AAAA-MM-JJ` décale la période |
| `scripts/verifier-publications.mjs` | Vérification (Node seul, sans dépendance) : code de sortie 1 s'il reste une erreur |

Régénérer après une correction : `node scripts/construire-publications.mjs` puis `node scripts/verifier-publications.mjs`.

## Contenu

- 50 publications du mardi 6 octobre au lundi 2 novembre 2026 : 1 ou 2 par jour, chaque jour couvert. Thèmes : lancement et slogan (4), aéroport Montréal-Trudeau (5), réservation 2 heures à l'avance (4), véhicules 100 % électriques (4), prix tout compris (3), commodités (4), sécurité et chauffeurs vérifiés (3), entreprises (3), devenir chauffeur (4), Neomoov Academy et Chauffeur Pro (4), quartiers et saisons (7), conseils de déplacement (3), coulisses (2).
- Chaque publication vise les neuf réseaux hors blogue avec un texte propre à chacun : Facebook ; légende Instagram avec 5 à 10 mots-clics ; LinkedIn en français puis en anglais (variante `en`) ; X en français puis en anglais, 280 caractères au plus chacune, lien compris ; TikTok, Snapchat et YouTube Short en 3 à 5 séquences (une ligne chacune, lue par la narration et mise en diapositive) avec légende ou description ; Telegram et chaîne WhatsApp en message court avec lien.
- Blogue : 9 articles de 600 à 900 mots (P01, P05, P14, P18, P27, P31, P39, P43, P49), au plus deux par semaine comme le prévoient les lignes éditoriales ; les 41 autres publications excluent le blogue.
- 559 contenus en tout (459 en français, 100 versions anglaises), chacun avec un titre d'image différent des autres titres de la même publication, et une indication de photo réelle (aéroport, véhicule électrique, chauffeur, ville ou client, règle D46).
- Appels à l'action : réservation (42), préinscription des chauffeurs (4, `chauffeurs/#candidature`), Academy (3) ; P28 (espace membre gratuit) porte l'adresse `neomoov.net/academy/inscription/` dans le texte, avec `cta: none`.
- Approbation humaine (`sensitive: true`) : P01, P03, P05, P07, P16, P18, P34, P50 (argent : prix publié ou paiement), P13, P25, P37 (sécurité).

## Règles et vérifications

Faits tirés seulement des lignes éditoriales v1.1, des pages publiques de neomoov.net (contenus du site) et de l'Academy (conditions de vente, modules). Aucun prix sauf 48,20 $ et 113,83 $ ; aucune promesse de revenu ni chiffre d'argent côté chauffeur ; rien sur la commission ; aucun concurrent ni marque de véhicule nommés ; aucune donnée personnelle (le fondateur n'est pas nommé) ; numéros +1 438 900 4990 et +1 438 805-7974 seulement ; adresses réservées seulement (plus la mention « page Entreprises de neomoov.net », sans lien) ; aucun tiret long ; emoji seulement sur Instagram, TikTok et Snapchat (un ou deux), au plus un sur Telegram et la chaîne WhatsApp ; vouvoiement ; anglais seulement dans les variantes LinkedIn et X. Aucun texte ne cite de jour de semaine : changer `startDate` décale le calendrier sans rendre un texte faux (seuls P47 et P48 citent leurs dates, 31 octobre et 1er novembre).

| Essai | Résultat |
|---|---|
| `node scripts/verifier-publications.mjs` (forme du fichier, texte recomposé de chaque réseau, longueurs, mots-clics, prix, numéros, adresses, tirets, emoji, mots interdits, tutoiement, anglais, séquences vidéo, mots du blogue, titres d'image, calendrier, `checkContent` du domaine de `main` chargé sans compilation) | 0 erreur, 0 avertissement ; 559 textes composés contrôlés, 459 brouillons passés à `checkContent` ; 17 signalements « tutoiement possible » du domaine écartés comme faux positifs (voir plus bas) |
| Code de la branche `publication-multireseau` (S2, `e370abe`), extrait dans un dossier temporaire et chargé par Node (`--experimental-transform-types`) : `publicationsImportSchema` (zod) | Conforme |
| Même code : `adaptForSpace` sur les 50 publications (limites des dix réseaux, Telegram et chaîne WhatsApp compris, `checkContent` avec les deux numéros et les trois adresses) | 559 contenus, aucun écart bloquant, aucun dépassement ; 21 « tutoiement possible » non bloquants, tous des faux positifs |
| Même code : `scheduleCampaign` (créneaux par défaut, 3 par jour au plus) comparé aux heures du document de lecture | 459 heures comparées, 0 différence |

## Constats pour la session principale et l'agent S2

1. Motifs du domaine sans drapeau `u` (`packages/domain/src/marketing/rules.ts`) : `\b` traite les lettres accentuées comme des séparateurs. `INFORMAL_FR` voit « tes » dans « êtes » et « te » dans « côte », « fête », « tête » (21 contenus du lot signalés à tort, non bloquant mais affiché) ; `SENSITIVE_TOPICS` voit « élection » dans « sélection » (j'ai reformulé P46 pour éviter le classement « sensible »). Correctif proposé : `(?<![\p{L}\p{N}])(?:tu|te|toi|ton|tes|…)(?![\p{L}\p{N}])` avec le drapeau `iu`, comme dans `scripts/verifier-publications.mjs`.
2. Snapchat : le format par défaut de S2 est `story`, qui donne une image ; les variantes Snapchat du lot portent `format: 'short'` pour obtenir la vidéo demandée (séquences).
3. X : la longueur est comptée sur l'adresse complète (28 caractères pour `/reserver`) alors que X la compte pour 23 ; le lot reste sous 280 dans les deux cas.
4. Telegram : S2 admet 5 mots-clics ; le lot n'en met aucun (message court).

## Décisions attendues du fondateur

1. Validation des 50 publications avant import, en priorité les 11 marquées « approbation humaine ». L'anglais n'utilise aucune traduction officielle du slogan (« Avancez vers demain. » est cité en français) ni de la Charte d'équité (« Charte d'équité (fairness charter) ») : à confirmer.
2. Date de départ : la mission dit « lundi 6 octobre 2026 », mais le 6 octobre 2026 est un mardi (l'exemple de S2 part du lundi 5). Le fichier part du mardi 6 (date écrite) ; pour partir du lundi 5, changer `startDate` (ou `node scripts/construire-publications.mjs --debut=2026-10-05`).
3. Blogue : 9 articles et non 10, pour tenir le rythme « un ou deux par semaine » des lignes éditoriales ; un dixième article est possible si ce rythme peut être dépassé la première semaine.
4. Adresses : `https://neomoov.net/entreprises` n'est pas parmi les adresses réservées (les publications Entreprises renvoient à la réservation et nomment la page sans lien) ; l'espace membre gratuit n'a pas de cible d'appel à l'action (adresse écrite dans P28). Ajouter `entreprises` et `member` à `marketing.cta_urls` et aux cibles du domaine ?
5. Lignes éditoriales : elles citent encore `neomoov.net/devenir-chauffeur` pour la préinscription, alors que le réglage `marketing.cta_urls` de `main` et la mission utilisent `neomoov.net/chauffeurs/#candidature` (utilisée ici).
6. Photos : la médiathèque doit contenir des photos réelles pour les sujets indiqués (aérogare et arrivées de Montréal-Trudeau, mont Royal en automne, Vieux-Montréal, Plateau, marché Jean-Talon, Halloween, tour de l'Horloge, rue enneigée, intérieurs de véhicules, chauffeurs et clients en modèles sous licence) ; sinon, l'import produit un gabarit de marque sans photo (règle D46).
7. Créneaux de Telegram (mardi et jeudi 17 h 30) et de la chaîne WhatsApp (lundi et jeudi 18 h) : défauts de S2, absents du réglage `marketing.slots` de `main` ; à confirmer.
8. Publication réelle : rien n'a été importé ni programmé ; l'import dans My Hub (Marketing, Publier, « Importer des publications ») et l'approbation restent à faire une fois les branches de S1, S2 et Q4 fusionnées et les comptes connectés.
