# Parcours Maestro de l'application chauffeur

Parcours de la section 9.2 du cahier des charges (prompt 11, tâche 8), pour simulateur iOS et émulateur Android.

## Prérequis

- Maestro installé (`curl -Ls "https://get.maestro.mobile.dev" | bash`), un simulateur iOS ou un émulateur Android démarré, localisation simulée activée (Montréal).
- API locale en développement (`NODE_ENV=development`, fournisseurs simulés, répartition automatique) : le code SMS simulé est écrit dans le journal de l'API (champ `devOtpCode`). Sur l'émulateur Android, l'API du poste est joignable à `http://10.0.2.2:4000` (profil EAS `development`).
- Build de développement installé (`eas build --profile development`) ou Expo Go avec `npx expo start`.
- La validation du dossier par l'équipe (My Hub, étape 12) et la réservation côté client se font en dehors de Maestro : par l'API, ou par le parcours web `e2e/web-journeys.cjs` qui les automatise.

## Exécution

Le code SMS n'est connu qu'après l'envoi : le parcours 10 s'arrête sur l'écran du code, puis reprend avec `OTP_CODE`.

```bash
maestro test -e PHONE=9995550301 maestro/10-inscription-chauffeur.yaml
# lire devOtpCode dans le journal de l'API, puis :
maestro test -e PHONE=9995550301 -e OTP_CODE=123456 maestro/10-inscription-chauffeur.yaml
```

Sur le poste de développement actuel (ni Maestro, ni SDK Android), le parcours équivalent est exécuté sur la version web par `e2e/web-journeys.cjs` (Edge sans interface, position simulée) ; ses captures sont dans `docs/screens/driver/`.

## Parcours

| Fichier | Parcours 9.2 | Contenu |
|---|---|---|
| `10-inscription-chauffeur.yaml` | 10 | Code SMS, candidature, identité et taxes, véhicule, documents photographiés, formation, compte de versement |
| `02-course-especes.yaml` | 2 | En ligne, offre reçue, course complète, montant reçu en espèces confirmé, évaluation du client, revenus |
| `08-annulation-chauffeur.yaml` | 8 | Annulation par le chauffeur en route, avec motif (réattribution automatique vérifiée par les tests de l'API) |
| `11-document-expire.yaml` | 11 | Suspension visible avec la marche à suivre, dépôt du nouveau document (la réactivation suit la validation humaine) |
| `12-pack.yaml` | 12 | Activation d'un pack, renouvellement automatique, changement programmé (consommation et report : étape 8) |
| `13-invitation-flotte.yaml` | Étape 23 (finalisation) | Invitation de flotte ouverte par le lien `neomoov-driver://chauffeurs/rejoindre?token=…` (variable `INVITE_TOKEN`), puis jeton collé depuis le profil (lien entier accepté, invitation inconnue refusée) |
| `14-booster-schema.yaml` | Booster (finalisation) | Conseils et schéma de chaque photo, rapport à la main, zone de carrosserie choisie puis retirée (rien n'est archivé) |
| `15-annulation-arrive.yaml` | Revue du 2 octobre B (finalisation) | « Annuler la course » présent en route, absent une fois arrivé avec le réglage par défaut |

Les parcours 2, 8, 11, 12, 14 et 15 supposent une session ouverte d'un chauffeur validé (lancer d'abord le parcours 10 sans `clearState`, puis valider le dossier).
