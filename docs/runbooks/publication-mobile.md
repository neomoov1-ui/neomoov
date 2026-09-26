# Publier une nouvelle version des applications mobiles

Étape 16 (prompt 16, tâches 4 et 6). Deux applications Expo : client (`apps/mobile-client`, `com.neomoov.client`) et chauffeur (`apps/mobile-driver`, `com.neomoov.driver`), compilées et soumises par EAS (compte Expo de l'organisation `neomoov`). Fiches des magasins : `docs/store/`. Aucun secret ici.

## 1. État de la configuration (26 septembre 2026)

| Élément | État | Conséquence |
|---|---|---|
| Profils `development`, `preview`, `production` (`eas.json` de chaque application) | Présents ; canaux `development`, `preview`, `production` | |
| Numéros de build | Gérés par EAS (`appVersionSource: remote`), incrémentés à chaque build `production` (`autoIncrement`) | Rien à changer à la main |
| Projet EAS lié (`extra.eas.projectId`) | **Absent** des deux `app.json` | À créer (`eas init` dans chaque dossier) avant le premier build ; active aussi les notifications push |
| Mises à jour à la volée (EAS Update) | **Non branchées** : le paquet `expo-updates` n'est pas installé et aucune `runtimeVersion` n'est déclarée | Toute correction passe par un nouveau build tant que ce n'est pas fait (manque signalé) |
| Soumission iOS (`submit.production.ios`) | `appleTeamId` et `ascAppId` vides | À remplir après la validation du compte Apple et la création des fiches dans App Store Connect |
| Soumission Android | Compte de service attendu dans `C:\Users\PC\cles-neomoov\google-play-service-account.json`, piste `internal` | Google Play exige en général un premier envoi manuel du fichier `.aab` dans la console avant d'accepter les envois automatiques (à vérifier au premier envoi) |
| Clés Google Maps des applications | Lues au build (`GOOGLE_MAPS_IOS_KEY`, `GOOGLE_MAPS_ANDROID_KEY`), à déclarer dans les variables d'environnement du projet Expo | Sans clé Android, la carte n'apparaît pas dans un build autonome |

## 2. Quel type de publication

| Changement | Publication |
|---|---|
| Texte, écran, logique en JavaScript ou TypeScript, image livrée avec le code | Mise à jour à la volée (quand EAS Update sera branché) ; sinon nouveau build |
| Nouveau module natif, montée de version d'Expo, permission, greffon ou réglage de `app.json` (icône, écran de démarrage, identifiant), clé Google Maps, son de notification | **Nouveau build** et nouvelle soumission aux magasins |
| Changement qui modifie la nature de l'application | Nouveau build et revue des magasins (les règles d'Apple et de Google interdisent de le faire par mise à jour à la volée) |

## 3. Numéros de version

- **Version affichée** (`expo.version` dans `app.json`, aujourd'hui `0.1.0`) : à changer à la main pour chaque version publiée dans les magasins. Proposition : `1.0.0` pour la première version publique, `1.0.1` pour une correction, `1.1.0` pour une fonction nouvelle. Les deux applications peuvent avoir des numéros différents.
- **Numéro de build** (iOS `buildNumber`, Android `versionCode`) : géré par EAS. Consulter : `npx eas-cli build:version:get`. Le fixer (rare, par exemple après une erreur) : `npx eas-cli build:version:set`.
- Quand les mises à jour à la volée seront branchées, la `runtimeVersion` devra suivre la version affichée (politique `appVersion`) : une mise à jour ne s'installe que sur les builds de même version, ce qui empêche d'envoyer du JavaScript à un build natif incompatible.

## 4. Construire et soumettre (depuis le poste)

Connexion au compte Expo, une fois par poste (interactif, jamais de jeton collé dans une commande) :

```
npx eas-cli@latest login
npx eas-cli@latest whoami
```

Pour chaque application (exemple client ; même chose dans `apps\mobile-driver`) :

```
cd C:\Users\PC\code\neomoov\apps\mobile-client
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --profile production --platform ios --latest
npx eas-cli@latest submit --profile production --platform android --latest
```

Durées indicatives : 15 à 40 minutes de build par plateforme (file d'attente du forfait gratuit), puis 10 à 30 minutes de traitement chez Apple avant l'apparition dans TestFlight.

Build d'essai installable par lien (Android, fichier APK, sans magasin) :

```
npx eas-cli@latest build --profile preview --platform android
```

Le profil `preview` pointe vers `https://api.neomoov.net` comme `production`. Sur iPhone, un build `preview` n'est installable que sur des appareils enregistrés (`npx eas-cli@latest device:create`) ; pour la bêta, préférer TestFlight.

## 5. Distribution

| Étape | iOS | Android |
|---|---|---|
| Équipe interne | TestFlight, testeurs internes (membres de l'équipe App Store Connect, 100 au plus), disponible dès le traitement | Test interne (liste d'adresses, 100 au plus), disponible en quelques minutes |
| Bêta fermée | TestFlight, testeurs externes (jusqu'à 10 000, par lien ou courriel) ; le premier build de chaque version passe une revue bêta d'Apple (souvent moins de 48 heures) | Test fermé (liste ou groupe Google), revue de Google |
| Production | Soumission à la revue avec les notes de `docs/store/` ; publication progressive sur 7 jours conseillée | Déploiement progressif (par exemple 10 %, 50 %, 100 %) |

Procédure de bêta complète : `docs/beta/procedure.md`. Liste de vérification avant soumission : `docs/store/verification-soumission.md`.

## 6. Mise à jour à la volée (quand EAS Update sera branché)

```
cd C:\Users\PC\code\neomoov\apps\mobile-client
npx eas-cli@latest update --channel production --message "Correction du libellé de l'écran de paiement"
```

Vérifier avant l'envoi que `EXPO_PUBLIC_API_BASE_URL` vaut l'adresse de production dans l'environnement de la commande (elle est figée dans le JavaScript publié). Tester d'abord sur le canal `preview`. Revenir à une mise à jour précédente : `npx eas-cli@latest update:republish` avec l'identifiant du groupe précédent (liste : `npx eas-cli@latest update:list`).

## 7. Retour arrière

Un build publié dans un magasin ne se retire pas : on publie un build correctif avec un numéro plus élevé. Pendant un déploiement progressif, suspendre la diffusion (App Store Connect : « Suspendre la publication progressive » ; Play Console : « Interrompre le déploiement »).

## 8. Liste de chaque version

1. `pnpm lint`, `pnpm typecheck`, `pnpm test` passent ; l'API déployée accepte la nouvelle version (compatibilité des routes).
2. Version affichée changée dans `app.json` si la version part dans les magasins ; commit.
3. Notes de version FR et EN (quelques lignes, sans jargon).
4. Build `preview` installé et essayé sur un iPhone et un Android réels (parcours principaux de `docs/testing/README.md`).
5. Build `production`, soumission, testeurs internes, puis bêta ou production.
6. Surveiller 48 heures : plantages dans App Store Connect (TestFlight, Plantages) et Play Console (Android vitals), retours des testeurs. Sentry n'est pas encore branché dans les applications.
7. Noter la version, la date et les numéros de build au registre d'exploitation.
