# Parcours Maestro de l'application client

Parcours de la section 9.2 du cahier des charges (prompt 10, tâche 8), pour simulateur iOS et émulateur Android.

## Prérequis

- Maestro installé (`curl -Ls "https://get.maestro.mobile.dev" | bash`), un simulateur iOS ou un émulateur Android démarré.
- API locale en développement (`NODE_ENV=development`, fournisseurs simulés) : le code SMS simulé est écrit dans le journal de l'API (champ `devOtpCode`). Sur l'émulateur Android, l'API du poste est joignable à `http://10.0.2.2:4000` (profil EAS `development`).
- Build de développement installé (`eas build --profile development`) ou Expo Go avec `npx expo start`.

## Exécution

Le code SMS n'est connu qu'après l'envoi : chaque parcours s'arrête sur l'écran du code, puis reprend avec `OTP_CODE`.

```bash
maestro test -e PHONE=9995550101 maestro/01-inscription-reservation.yaml
# lire devOtpCode dans le journal de l'API, puis :
maestro test -e PHONE=9995550101 -e OTP_CODE=123456 maestro/01-inscription-reservation.yaml
```

Sur le poste de développement actuel (ni Maestro, ni SDK Android), le parcours équivalent est exécuté sur la version web par `e2e/web-journeys.cjs` (Edge sans interface) ; ses captures sont dans `docs/screens/client/`.

## Parcours

| Fichier | Parcours 9.2 | Contenu |
|---|---|---|
| `01-inscription-reservation.yaml` | 1 (V1 : réservation planifiée, pas de course immédiate, D32) | Code SMS, conditions, consentements, réservation en trois écrans, course réservée |
| `03-planifiee-vol.yaml` | 3 | Réservation avec numéro de vol, détail du prix, confirmation |
| `04-tiers.yaml` | 4 | Réservation pour un tiers (nom et téléphone du passager) |
| `05-vehicule-precis.yaml` | 5 (partie « véhicule choisi » ; le choix parmi « Mes chauffeurs » arrive à l'étape 8) | Choix d'un véhicule libre sur le créneau |
| `06-annulation.yaml` | 6 | Annulation gratuite avant l'attribution |

Les parcours 3 à 6 supposent une session ouverte (lancer d'abord le parcours 1 sans `clearState`).
