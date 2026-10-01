# Étape 22 : marque par organisation dans l'application unique et le web

Revue de fin d'étape, 1er octobre 2026. Branche `etape-22-marque` (agent C). Source : amendement v1.2, section 5 et étape 22 ; décision D11 du fondateur (une seule application publiée). Critère : « deux organisations de test, deux marques, une seule application ».

## Critères d'acceptation

| Critère | Résultat |
|---|---|
| Deux organisations de test, deux marques, une seule application | Oui : `branding.e2e` crée Taxi Alpha et Taxi Beta, deux marques ; chaque client rattaché par code reçoit la sienne par `GET /v1/config` ; les deux applications Expo appliquent la marque reçue, sans build propre à l'organisation |
| Marque publique par code et par domaine | Oui : `GET /v1/public/brand?code=` (saisie tolérante : minuscules, tiret) et `?domain=` (domaine vérifié seulement, hôte normalisé), sans donnée personnelle, `Cache-Control: public, max-age=60` |
| Rattachement par code | Oui : `POST /v1/me/organizations/attach`, consentement au journal d'audit, idempotent, changement d'organisation possible (une seule organisation cliente par profil en V1) |
| `GET /v1/config` renvoie la bonne marque à chaque utilisateur | Oui : Alpha pour le client d'Alpha, Beta pour celui de Beta, Neomoov sans jeton ou sans organisation ; liste des organisations pour le sélecteur |
| Modification avec la permission, refus sans | Oui : 403 `FORBIDDEN_ROLE` (permission `brand.edit` en détail) sans rôle ; lecture avec `organizations.read` ; écriture avec `brand.edit` ; domaines avec `domains.manage` ; vérification réservée à la plateforme (`domains.verify`) |
| Validation des couleurs et du contraste | Oui : couleur non hexadécimale 400 ; contraste sous 4,5 pour 1 (texte sur fond, texte blanc sur la couleur principale) 400 `BRAND_CONTRAST` avec les paires en détail ; rien n'est enregistré |
| Dans `OrgScopeService.run(A)`, la marque de B est invisible (politique) | Oui : lecture de `brands` et `organization_domains` limitée à A, mise à jour de B sans effet, insertion pour B refusée, A reste modifiable |
| Courriels et textos : deux organisations, deux expéditeurs | Oui : `Taxi Alpha <adresse de la plateforme>` et `Service Taxi Beta <...>`, objet et pied au nom de la marque, assistance de la marque ; la plateforme garde `EMAIL_FROM` ; push au nom de Neomoov |

## Ce qui est livré

- **Données** : migration `0022_brands` et son inverse (`drizzle/down/0022_brands.sql`) : tables `brands` et `organization_domains`, colonne `organizations.join_code` (fonction `generate_join_code()`, organisations existantes reprises), droits et politiques `org_isolation` pour `neomoov_scoped`, permissions de la marque. Appliquée sur la base de développement (vérifié : tables, colonne non nulle avec valeur par défaut, codes distincts, deux politiques, trois permissions).
- **Domaine** `packages/domain/src/branding/` : `brand.ts` (schémas Zod, marque Neomoov du prompt 0, `resolveBrand`, `applyBrandUpdate`, contraste WCAG `contrastRatio` et `brandContrastIssues`, résumés), `join-code.ts` (génération, normalisation, schéma, lien), `domains.ts` (normalisation d'un hôte, schémas des domaines, enregistrement TXT, requête publique, rattachement). Couverture 100 %.
- **API** : module `branding` (service, trois contrôleurs), marque et organisations dans `GET /v1/config`, expéditeur et nom de marque dans le service des avis (`brandOf`, `emailFrom`), option `from` de `EmailProvider` (Resend et simulé), réglages de départ `public.brand_per_ip_per_hour` et `email.sender_domains`.
- **Client d'API** : ressource `branding` (marque publique, rattachement, administration de la marque et des domaines), OpenAPI régénérée.
- **Applications Expo** : `mobile-core` (`brand-theme.ts` : couleurs dérivées ; `brand.tsx` : `BrandProvider`, `useBrand`, `useBrandColors`, `BrandPreview` ; boutons, écrans, choix, interrupteurs et chargement aux couleurs de la marque) ; dans chaque application : fournisseur à la racine, onglet actif, accueil, assistance, conditions, écran `join` et lien `c/[code]`, sélecteur d'organisation dans le profil, liens universels `https://neomoov.net/c/<code>` (`app.config.ts`), textes `fr-CA` et `en`.
- **Web** : `lib/brand.ts` (variables CSS, hôte, titre), `lib/server/brand.ts` (résolution par l'hôte, cache 60 s, clé publique du serveur), `components/brand-context.tsx` (contexte, `BrandMark`) ; mise en page racine (variables CSS sur `<html>`, titre), en-tête du site, connexion et cadre de My Hub, réservation et invitation (conditions de la marque), titres de `/reserver` et de la connexion, page `/c/<code>`, CSP `img-src https:`.

## Écrans (description ; captures à prendre sur un poste moins chargé)

- **Application client et chauffeur, accueil** : logo de l'organisation (sinon celui de Neomoov), nom commercial en titre, signature de la marque, « Propulsé par Neomoov », pastilles de langue à la couleur principale. Sans organisation : écran inchangé.
- **Rejoindre une organisation** (Profil, « Rejoindre une organisation », ou lien `neomoov.net/c/<code>`) : champ du code (8 caractères), aperçu de la marque (pastille de la couleur principale, nom, signature) dès que le code est complet, bouton « Rejoindre » ; sans session, le code est gardé et l'écran revient après la connexion ; message de réussite puis « Continuer ». Côté chauffeur, une note précise que conduire pour la flotte passe par une invitation de l'organisation.
- **Profil** : section « Mon organisation » (organisation actuelle, ou sélecteur si plusieurs), bouton « Rejoindre une organisation ».
- **Assistance** : téléphone et courriel de l'assistance de la marque (« Appeler Taxi Alpha »).
- **Web** : en-tête au nom ou au logo de la marque de l'hôte, boutons et liens à sa couleur principale, fond et texte de la marque ; `/c/<code>` : carte de la marque, code, marche à suivre dans l'application, lien vers la réservation.

## Tests lancés

Voir le rapport final de l'agent (comptes exacts) : domaine (couverture 100 %), client d'API, `mobile-core`, application client, application chauffeur, web, suite `branding.e2e` sous le verrou de la base, types de tous les paquets touchés.

## Reste à faire et accès à fournir

- **Domaine d'envoi des courriels d'une organisation** : authentifier son domaine chez Resend (enregistrements SPF et DKIM chez le client), puis l'ajouter au réglage `email.sender_domains` ; d'ici là, ses courriels partent de l'adresse de la plateforme avec le nom de sa marque.
- **Liens universels** : publier `/.well-known/apple-app-site-association` (identifiants d'équipe Apple et des deux applications, chemin `/c/*`, application client en premier) et `/.well-known/assetlinks.json` (empreintes SHA-256 des certificats de signature Android) sur `neomoov.net`, site WordPress chez LWS ; rediriger `neomoov.net/c/*` vers la page `/c/<code>` du web Next.js quand l'application n'est pas installée. Nouveau build natif des deux applications (domaines associés et filtres d'intention), une mise à jour à la volée ne suffit pas.
- **Domaines des organisations sur le web** : DNS du client vers le serveur web, certificat TLS (Caddy, émission à la demande à configurer pour les domaines vérifiés seulement), vérification manuelle du TXT avant `verify`.
- **Numéro de textos dédié** (`sms_sender`) : stocké, non employé (option payante plus tard).
- **My Hub** : écran de la marque et des domaines d'une organisation (les routes et le client d'API sont prêts ; l'écran « Organisations et accès » de l'étape 19/21 peut les accueillir).
- **Captures** des écrans dans `docs/screens/` (client, chauffeur, web) avec une organisation de démonstration.
- **Application dédiée au nom du client** : hors périmètre (option payante, son propre compte développeur).

## Pièges rencontrés

- Le générateur de migrations charge `@neomoov/domain` compilé : `pnpm --filter @neomoov/domain build` avant `drizzle-kit generate` (sinon « Cannot find module .../domain/dist/index.js »).
- `exactOptionalPropertyTypes` : une interface de domaine destinée à recevoir un objet Zod partiel doit déclarer `| undefined` sur ses champs facultatifs.
- La lettre L ressemble à 1 et à I : retirée de l'alphabet du code (31 caractères), même alphabet dans le domaine et dans `generate_join_code()`.
- L'application client compile contre `packages/api-client/dist` : reconstruire le client d'API après l'ajout d'une ressource, sinon des dizaines d'erreurs « implicitly has an any type » en cascade.
- Poste partagé saturé (processeur à 100 %, 400 Mo libres pendant les suites des autres agents) : une vérification de types de l'API a pris plus de 10 minutes ; une coupure réseau vers Supabase (`ENOTFOUND`) a fait échouer une première exécution de `branding.e2e` sans rapport avec le code.
