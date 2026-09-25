# Localisation en arrière-plan de l'application chauffeur : protocole de test sur appareil réel

Prompt 11, tâche 3 : la localisation en arrière-plan se vérifie sur un téléphone réel (le simulateur iOS et l'émulateur Android ne reproduisent ni l'écran verrouillé réel ni la gestion de la batterie). Ce document décrit le test à faire par le fondateur, et consigne les mesures déjà faites.

## Fonctionnement attendu

- **En ligne ou en pause** : une tâche `expo-task-manager` (`neomoov-driver-location`) reçoit les positions du système (Android : toutes les 5 secondes par un service de premier plan avec notification persistante ; iOS : mode `location`, environ une position par seconde, réduite dans l'application à une position toutes les 5 secondes ou tous les 50 mètres). Les positions partent par lots (`POST /v1/driver/locations`, 100 au plus) ; en cas de coupure réseau, elles sont gardées dans un fichier de l'application (500 au plus) et renvoyées à la position suivante.
- **Hors ligne** : le statut est enregistré sur le téléphone avant tout, la tâche est arrêtée, la file est vidée ; une position livrée après coup par le système est ignorée. Aucune position ne part hors ligne (test automatisé : `apps/mobile-driver/test/location.test.ts`).
- **Redémarrage** : à l'ouverture, le statut de l'API fait foi ; la tâche reprend si le chauffeur était en ligne, l'écran de la course en cours se rouvre.

## Mesures déjà faites (version web, Edge sans interface, 26 septembre 2026)

| Mesure | Résultat |
|---|---|
| Positions reçues par l'API en ligne | 16 en 115 secondes, avec quinze rechargements complets de page pendant la période (chaque rechargement coupe l'envoi le temps du démarrage) |
| Positions reçues après le passage hors ligne | 0 sur 12 secondes d'observation |
| Règle « hors ligne » | Vérifiée par le test automatisé et par le parcours web |

Le navigateur ne rappelle la position que si elle change et resert une position en cache avec sa date d'origine : la version web relève la position toutes les 5 secondes et la date à sa réception. Ces deux particularités n'existent pas sur iOS et Android.

## Test sur appareil réel (à faire par le fondateur)

Matériel : un Android récent et un iPhone, build `preview` installé (EAS), API de staging ou locale, un chauffeur validé.

### 1. Fréquence des positions pendant 10 minutes (critère de l'étape)

1. Passer en ligne, accepter « Toujours autoriser ».
2. Verrouiller l'écran, poser le téléphone ; attendre 5 minutes. Puis rouler 5 minutes (ou marcher) écran verrouillé, avec Google Maps ouvert par-dessus.
3. Passer hors ligne. Noter l'heure de début et de fin.
4. Mesurer côté API (base de données) :

```sql
SELECT count(*) AS positions,
       round(extract(epoch FROM max(recorded_at) - min(recorded_at))) AS secondes,
       round(extract(epoch FROM max(recorded_at) - min(recorded_at)) / NULLIF(count(*) - 1, 0), 1) AS intervalle_moyen
FROM driver_locations
WHERE driver_id = '<identifiant du chauffeur>' AND recorded_at BETWEEN '<début>' AND '<fin>';
```

Attendu : un intervalle moyen de 5 à 6 secondes à l'arrêt (Android) et en mouvement ; à l'arrêt sur iOS, une position toutes les 5 secondes tant que le système en livre.

5. Vérifier qu'aucune position n'arrive après le passage hors ligne :

```sql
SELECT count(*) FROM driver_locations WHERE driver_id = '<identifiant>' AND recorded_at > '<heure du passage hors ligne>';
```

Attendu : 0.

### 2. Coupure réseau

Mode avion 2 minutes en ligne (en course de préférence), puis réseau rétabli : les positions de la coupure arrivent d'un coup (`recorded_at` réguliers pendant la coupure), la présence est recréée si elle avait expiré.

### 3. Redémarrage et arrêt forcé

- Fermer l'application (balayage) en ligne : sur Android, le service continue ; sur iOS, la tâche est relancée par le système au prochain déplacement significatif. Rouvrir : le statut « En ligne » est restauré, les envois reprennent.
- Redémarrer le téléphone en ligne : à l'ouverture, l'application reprend l'envoi (ou affiche « Hors ligne » si la présence a expiré côté API).

### 4. Batterie (à consigner)

Téléphone chargé à 100 %, en ligne 1 heure écran verrouillé, puis relever le pourcentage et l'écran « Batterie » du système (part de Neomoov Chauffeur).

| Appareil | Système | Durée en ligne | Batterie consommée | Part de l'application | Intervalle moyen mesuré |
|---|---|---|---|---|---|
| (à remplir) | | | | | |

Repère : une application de navigation consomme de l'ordre de 5 à 10 % par heure écran verrouillé ; au-delà de 10 %, réduire la précision (`Accuracy.Balanced`) hors course.

## Réglages en jeu

| Réglage | Où | Valeur |
|---|---|---|
| Intervalle d'envoi | `apps/mobile-driver/src/lib/location.ts` (`INTERVAL_MS`) et API (`presence.min_interval_seconds`) | 5 secondes |
| Distance minimale | API (`presence.min_distance_meters`) et règle de l'application | 50 mètres |
| Expiration de la présence sans position | API (`presence.expiry_seconds`) | 60 secondes |
| File locale | `location-buffer.ts` (`max`) | 500 positions |
