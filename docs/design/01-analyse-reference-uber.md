# Neomoov. Analyse de la référence Uber

Version 1.0, 22 septembre 2026. Niveau interne, confidentiel. Groupe NSK Inc.

Ce document consigne ce que montrent les captures d'écran et les relevés Uber fournis par le fondateur le 22 septembre 2026, et ce que Neomoov en retient. Il sert trois usages : guider le design des applications, compléter le cahier des charges là où il est muet, et fixer le modèle des relevés envoyés aux chauffeurs.

Il dérive du document de référence v1.0 et du cahier des charges v1.0. Quand une proposition de ce document contredit l'un des deux, c'est le document de référence qui l'emporte, et la proposition doit d'abord y être arbitrée.

---

## 0. Sources

| Source | Contenu | Emplacement |
|---|---|---|
| 232 captures uniques (245 reçues, 13 doublons écartés) | Application Uber Driver surtout, quelques écrans de l'application passager, courriels, notifications. Période : février à septembre 2026 | `context/import/neomoov/reference-uber/captures/` |
| Relevé hebdomadaire, 9 au 16 février 2026, 17 pages | Récapitulatif, détail des revenus, remboursements et dépenses, semaines précédentes, journal des transactions | `context/import/neomoov/reference-uber/releves/` |
| Récapitulatifs fiscaux mensuels, février et mars 2026, 2 pages chacun | Prix bruts, frais payés à Uber, données pour la déclaration de TPS et TVQ, kilométrage | Même dossier |

**Données sensibles.** Ces documents contiennent des renseignements personnels de tiers (prénoms et adresses de passagers, photos et numéros de TVQ d'autres chauffeurs) et du fondateur (photo, date de naissance, téléphone, courriel, plaque, attestation de casier judiciaire, numéros de taxes). Règles : le dossier reste hors Git, rien n'en sort vers un service externe, aucune maquette ne reprend un nom, une adresse ou une photo réels. Les maquettes utilisent des données fictives.

**Limite juridique.** Neomoov reprend des principes d'ergonomie, ce qui est une pratique normale. Neomoov ne reprend ni l'identité visuelle d'Uber (noir et blanc, police, pictogrammes, illustrations), ni ses textes, ni ses noms de produits (Quest, Uber Pro, Amplificateur+, Reserve).

---

## 1. Ce que les chiffres réels nous apprennent

Ces chiffres viennent du compte du fondateur. Ils servent d'étalon pour le moteur de tarification, le discours aux chauffeurs et le dossier investisseurs.

### 1.1 Le profil du fondateur comme chauffeur

| Indicateur | Valeur | Source |
|---|---|---|
| Courses totales | 2 540 en 9 mois (2 372 courses, 168 livraisons) | Profil, juillet 2026 |
| Note | 4,98 sur les 500 dernières notes (496 notes de 5 étoiles) | Note en étoiles, septembre 2026 |
| Taux d'annulation | 2 % sur les 100 dernières courses acceptées | Septembre 2026 |
| Niveau de fidélité | Niveau le plus élevé, trois périodes de suite (1 802 points de février à avril, 1 804 de mai à juillet) | Écrans de niveau |
| Classement | Parmi les 25 % de chauffeurs les plus performants de la région, selon les revenus par heure en ligne | Message d'Uber |
| Jalons | 1 000 courses notées 5 étoiles, puis 1 250 notes de 5 étoiles le 9 septembre 2026 | Badge et notification |
| Véhicule | Chevrolet Equinox EV, 100 % électrique | Compte |
| Exploitant | Groupe NSK Inc. figure sur le bon de commande de chaque course | Bon de commande |

À exploiter dans le dossier investisseurs : le fondateur connaît le métier de l'intérieur, avec des résultats mesurés et vérifiables.

### 1.2 Ce que gagne un très bon chauffeur à Montréal

| Semaine | Revenus | En ligne | Au volant | Courses | Par heure en ligne | Par course |
|---|---|---|---|---|---|---|
| 9 au 16 février 2026 | 1 268,07 $ | 58 h 39 | 46 h 01 | 102 | 21,62 $ | 12,43 $ |
| 9 au 16 mars 2026 | 2 006,85 $ (dont 170 $ de promotions) | 83 h 34 | 59 h 27 | 154 | 24,01 $ | 13,03 $ |
| 16 au 23 mars 2026 | 2 119,29 $ | | | | | |
| 23 au 30 mars 2026 | 1 757,95 $ | | | | | |

Journée type : 300 $ à 320 $ pour 12 h à 15 h en ligne et 23 à 27 courses. Les meilleures journées (512,22 $ le 19 mars, 489,81 $ le 26 mars) tiennent aux promotions : le 19 mars, 215 $ de promotions sur 512 $, soit 42 % du revenu du jour.

Ces montants sont avant les coûts du véhicule, de l'énergie, de l'assurance et des impôts. Un revenu de 21 $ à 24 $ de l'heure demande 60 h à 80 h en ligne par semaine.

**Conséquence pour Neomoov.** Le revenu du chauffeur Uber dépend de primes changeantes et à seuil : une prime de 100 $ est perdue à 67 courses sur 70. Le modèle Neomoov (zéro commission, packs à coût connu, prix fixe) peut se présenter comme l'inverse : un revenu prévisible, sans loterie.

### 1.3 Ce que le chauffeur garde de ce que paie le client

Semaine du 31 août au 7 septembre 2026, écran « Détail du prix de la course pour l'utilisateur » :

| Poste | Montant | Part |
|---|---|---|
| Paiements du client | 971,99 $ | 100 % |
| Taxes gouvernementales et autres tiers | 258,57 $ | 27 % |
| Coûts estimés d'assurance et de traitement des paiements | 44,32 $ | 4 % |
| Montant conservé par Uber | 75,83 $ | 8 % |
| Revenus du chauffeur issus du prix des courses | 593,27 $ | 61 % |
| Pourboires (en plus) | 39,94 $ | |

Autres mesures, sur une base différente (le prix de la course, et non le paiement total du client) :
- Frais de service sur une course Confort du 12 février : 15,29 $ sur 54,59 $, soit 28 %.
- Semaine du 9 au 16 février : 404,94 $ de frais de service sur 1 689,06 $ de prix de course, soit 24 %.
- Mars 2026 : 2 155,37 $ de frais de service sur 9 084,34 $ de prix bruts, soit 23,7 %, plus 1 076,88 $ d'autres montants (frais de réservation, frais d'aéroport) et 342,17 $ de rabais sur les frais.

**Message utilisable :** sur 100 $ payés par le client, le chauffeur Uber reçoit 61 $.

**Mise en garde.** Zéro commission ne veut pas dire 100 $ au chauffeur. Sur 100 $ payés, Neomoov doit aussi prévoir la TPS et la TVQ (environ 13 $), la redevance de 0,90 $, le frais de service client de 2 $ et le traitement du paiement (environ 3 $). L'ordre de grandeur est de 80 $ au chauffeur avant le coût du pack. Ce chiffre est indicatif : il doit être calculé par le modèle financier avant toute publication.

### 1.4 Mécanique fiscale québécoise observée

- **Redevance.** « Montants dus au MTQ » : 239,40 $ en février, soit 266 courses à 0,90 $. 532,80 $ en mars, soit 592 courses. Cela confirme la redevance de 0,90 $ par course du document de référence.
- **TPS et TVQ.** Uber perçoit les taxes auprès des passagers et les remet à Revenu Québec au nom du chauffeur, en vertu d'une entente fiscale propre à Uber. Le chauffeur reçoit chaque semaine une remise de 6,085 % des revenus bruts (méthode rapide de comptabilité) : 17,61 $, 139,86 $ et 148,56 $ selon les semaines.
- **Numéros de taxes.** Le numéro de TVQ du chauffeur est affiché sur son profil public, visible du passager.

**Question ouverte, à poser à un comptable ou à Revenu Québec :** Neomoov doit-elle, ou peut-elle, percevoir et remettre les taxes au nom des chauffeurs comme le fait Uber ? La réponse change le relevé, la facture et le moteur de règlement.

### 1.5 Étalons de prix

Prix payés par le client (application passager), avant et après promotion :

| Trajet | Catégorie | Prix affiché | Prix avant promotion |
|---|---|---|---|
| Laval vers l'est de Montréal, course courte | Standard | 16,50 $ | 18,98 $ |
| Idem | Grand véhicule | 32,63 $ | 37,53 $ |
| Idem | Confort | 25,05 $ | 28,81 $ |
| Montréal vers Chambly | Partagé | 29,09 $ | 41,82 $ |
| Idem | Standard | 37,17 $ | 53,44 $ |
| Idem | Confort | 59,64 $ | |
| Idem | Grand véhicule | 82,19 $ | 102,19 $ |
| Montréal vers Salaberry-de-Valleyfield | Standard | 55,06 $ | 75,06 $ |
| Idem | Grand véhicule | 125,23 $ | |
| Trajet long depuis Laval | Standard | 48,65 $ | 68,65 $ |
| Idem | Confort | 80,27 $ | 100,27 $ |
| Idem | Confort électrique | 92,23 $ | 112,23 $ |

Ce que reçoit le chauffeur :

| Course | Distance et durée | Revenu du chauffeur | Par kilomètre |
|---|---|---|---|
| Montréal vers Venise-en-Québec, partagé | 71,9 km, 54 min 50 s | 49,94 $ | 0,69 $ |
| Montréal vers Saint-Bernard-de-Lacolle, partagé | 61,29 km, 48 min 57 s | 44,14 $ | 0,72 $ |
| Aéroport vers Mascouche | 49,54 km, 1 h 17 | 40,96 $ | 0,83 $ |
| Aéroport vers l'est de Montréal | 41,62 km, 43 min 41 s | 36,67 $ plus 9,80 $ de péage | 0,88 $ |
| Laval vers Montréal-Est | 27,23 km, 23 min 37 s | 21,16 $ plus 9,80 $ de péage | 0,78 $ |
| Centre vers aéroport, Confort | 17,2 km, 37 min 38 s | 20,53 $ | 1,19 $ |
| Brossard vers Montréal | 13,53 km, 21 min 41 s | 12,35 $ | 0,91 $ |
| Course urbaine courte | 3,46 km, 12 min 7 s | 26,36 $ (majoration de nuit) puis 31,31 $ avec pourboire | |

Réservations à l'avance proposées aux chauffeurs : 16,65 $ pour 11,1 km vers l'aéroport à 5 h 45, 22,21 $ pour 18,7 km, 24,80 $ pour 25,3 km, 135,00 $ pour 125,1 km, 172,44 $ pour 167,5 km. Les demandes arrivent en rafale la nuit pour le petit matin (4 h 45 à 6 h 45), surtout vers l'aéroport.

**Conséquence.** Ces valeurs donnent 40 cas de test réalistes pour le moteur de tarification (étape 4 du plan). Le prix Neomoov doit rester lisible face à ces étalons, et le revenu par kilomètre du chauffeur doit dépasser nettement 0,70 $ à 0,90 $.

### 1.6 Règles d'exploitation observées

| Règle | Détail | Pour Neomoov |
|---|---|---|
| Temps de conduite | 12 h à la fois, remise à zéro après 6 h hors ligne (l'aide en ligne dit 13 h et 10 h). Compteur « temps de conduite disponible » | À ajouter au cahier des charges : limite de conduite et compteur visible |
| Vérification des antécédents | Casier judiciaire et dossier de conduite par un fournisseur spécialisé. Coût de 80 $ récupéré à 20 $ par semaine sur quatre semaines | Même principe possible. À chiffrer |
| Document non conforme | Un écart de nom sur l'assurance bloque le passage en ligne : « Actions requises (1) », explication, exemple du document attendu, téléverser ou photographier. Accès rétabli après correction | Reprendre ce parcours pour les échéances et suspensions |
| Réservation | Être en ligne 30 minutes avant. Annuler au moins 60 minutes avant, sans effet sur le taux d'annulation. 5 minutes d'attente incluses. Frais d'annulation si le client annule tard | Reprendre ces règles, affichées avant l'acceptation |
| Attente payée | 0,50 $ par minute après le délai gratuit, avec barre de progression par tranches | Déjà prévu (compteur d'attente) |
| Bon de commande | Document par course : exploitant, numéro de course, heure, passager, origine, destination, chauffeur, plaque, capacité | À ajouter : preuve de course à présenter lors d'un contrôle |
| Versement instantané | Frais de 1,49 $ par virement, jusqu'à huit virements dans la semaine observée (10,43 $ de frais) | Neomoov règle chaque semaine. Un virement instantané payant est une option V1.1 |

---

## 2. Principes de présentation à reprendre

### 2.1 Structure

| Principe | Description | Application Neomoov |
|---|---|---|
| Carte d'abord | L'accueil du chauffeur est une carte plein écran. Le reste vit dans une feuille qui monte du bas | Identique pour le chauffeur et pour la réservation du client |
| Une action par écran | Un seul bouton principal, pleine largeur, en bas | Identique. Bouton en dégradé bleu vers vert pour l'action principale |
| Cinq onglets | Accueil, Découvrir, Revenus, Boîte de réception, Menu | Chauffeur : Accueil, Courses planifiées, Revenus, Messages, Menu. Client : Accueil, Réservations, Historique, Assistance, Profil |
| Titres très grands | Titre de page en très gros, gras, aligné à gauche. Montants en très gros | Identique, en Montserrat |
| Lignes de liste | Pictogramme, titre, description grise, chevron. Séparateurs fins | Identique |
| Cartes | Coins arrondis de 12 à 16 px, bordure fine, peu d'ombre | Identique |
| Pastilles d'état | Vert « Approuvé », ambre « En attente », bleu « Nouveau » | Identique, mêmes trois couleurs sémantiques |
| Progression | Barres pleines, segmentées pour l'attente. Paliers cochés en vert | Pour le pack actif et pour les documents |
| Graphiques | Barres simples par jour, jour choisi en couleur pleine, ligne pointillée du maximum. Anneau pour la répartition | Identique |
| Glisser pour confirmer | Début et fin de course par un bouton à glisser, pour éviter les appuis accidentels | Identique. Indispensable au volant |
| Compte à rebours | Le bouton « Accepter » se remplit pendant le délai | Identique, 15 secondes |
| Bandeau de navigation | Bandeau sombre en haut, texte blanc, prochaine manœuvre | Neomoov renvoie à Google Maps ou Waze. Garder le bandeau d'adresse et d'étape |
| Repères | Vert pour la prise en charge, rouge pour la destination | Identique |
| Mode sombre | Disponible, utile la nuit | À prévoir dès le système de design |

### 2.2 Ce que Neomoov fait autrement

- Identité propre : bleu électrique foncé `#0B5FB5`, bleu électrique `#1485E0`, vert lime `#6CC04A`, gris anthracite `#2C3A4A`, dégradé bleu vers vert pour les accents, fond sombre pour les écrans d'accueil, titres en Montserrat Bold et textes en Nunito, logo « neomoov », signature « Avancez vers demain. ».
- Le prix est affiché tout compris, avec un détail dépliable (tarif, frais de service, redevance, taxes, suppléments). Uber affiche un prix barré et une promotion : Neomoov n'utilise pas ce procédé.
- Le modèle garanti du véhicule apparaît au choix de la catégorie.
- La transparence est un argument : l'écran de répartition du prix montre « Commission Neomoov : 0,00 $ ».
- Tout est en français du Québec d'abord : montants « 12,35 $ », heures « 5 h 45 », dates « lundi 14 septembre ».

---

## 3. Fonctionnalités observées et décision proposée

Légende : **V1** dans le sprint, **V1.1** d'octobre à décembre 2026, **V2** en 2027, **Non** non retenu. « Prévu » veut dire déjà au cahier des charges. « À arbitrer » veut dire absent du cahier des charges : la décision revient au fondateur.

### 3.1 Application chauffeur

| Fonction observée chez Uber | Proposition | Statut |
|---|---|---|
| Passage en ligne en un geste, avec blocage et marche à suivre si un document manque | V1 | Prévu |
| Offre de course : catégorie, prix, note du client, distance d'approche, durée, adresses, compte à rebours | V1 | Prévu |
| Borne de recharge rapide la plus proche, sur l'offre de course | V1.1. Très pertinent pour une flotte 100 % électrique | À arbitrer |
| Étapes de course : en route, arrivé, attente chronométrée, à bord, arrêt, terminé | V1 | Prévu |
| Arrêts multiples et revenu pour le temps à l'arrêt | V1 | Prévu |
| Appel et message masqués, réponses rapides, traduction | V1 pour l'appel, le message et les réponses rapides. Traduction en V1.1 | Prévu en partie |
| Signalement d'un problème selon l'étape (client introuvable, trop de passagers, mineur seul, pas de siège d'enfant, comportement, véhicule) | V1, avec ces motifs | Prévu, motifs à reprendre |
| Évaluation du client en fin de course | V1 | Prévu |
| Courses planifiées à choisir, avec règles affichées avant l'acceptation et rappel de repasser en ligne | V1 | Prévu, règles à reprendre |
| Résumé de séance : durée, revenu, courses faites et offertes | V1 | À arbitrer, coût faible |
| Revenus : jour, semaine, barres, statistiques (en ligne, au volant, courses), détail | V1 | Prévu |
| Détail d'une course : prix, carte, durée, distance, rues sans numéro, péages remboursés, explication d'un écart de prix | V1 | Prévu |
| Répartition du paiement du client (chauffeur, plateforme, tiers) | V1, avec « Commission Neomoov : 0,00 $ » | À arbitrer, argument fort |
| Portefeuille, solde, prochain versement | V1 | Prévu |
| Versement instantané payant | V1.1 | À arbitrer |
| Bon de commande par course et preuve d'état pour les forces de l'ordre | V1 | À arbitrer, probablement exigé |
| Temps de conduite restant et limite | V1 | À arbitrer, sécurité |
| Détail de la note (répartition des étoiles) et du taux d'annulation | V1, dans le tableau de conduite | Prévu |
| Préférences : catégories acceptées, zones, note minimale du client | V1 pour les catégories et les zones. Note minimale : Non, risque de discrimination | Prévu en partie |
| Mode destination (courses sur mon chemin) | V1.1 | À arbitrer |
| Carte de la demande, tendances par heure et par zone | V2, il faut du volume | À arbitrer |
| Calendrier des événements de la semaine (concerts, matchs) | V1.1, produit par un agent IA | À arbitrer |
| Primes à seuil, majorations par zone, garanties horaires | Non. Le modèle Neomoov est le pack. Le widget de prime devient le suivi du pack actif | Conforme au document de référence |
| Programme de fidélité à niveaux | V2 | À arbitrer |
| Vérification par NIP à la montée | V1.1 | À arbitrer |
| Enregistrement audio ou vidéo des courses | Non en V1. Lourd au regard de la Loi 25 | À arbitrer avec avis juridique |
| Partage de ma position avec mes proches (chauffeur) | V1.1 | À arbitrer |
| Assistance 911 avec transmission de la position et des détails | V1, bouton SOS | Prévu |
| Signalements sur la carte, limite de vitesse et alertes | Non. La navigation est confiée à Google Maps ou Waze | |
| Profil public : photo, prénom, note, ancienneté, langues, compliments, badges, numéro de TVQ | V1 pour la photo, le prénom, la note, le véhicule, les langues et le numéro de TVQ. Compliments et badges en V1.1 | Prévu en partie |

### 3.2 Application client

| Fonction observée chez Uber | Proposition | Statut |
|---|---|---|
| Carte avec trajet, délai de prise en charge, adresses modifiables | V1 | Prévu |
| Liste des catégories : places, heure d'arrivée, délai, étiquette (plus rapide, plus économique), prix | V1, avec modèle garanti et prix tout compris | Prévu |
| Mode de paiement rappelé sous la liste | V1 | Prévu |
| Bouton de planification à côté du bouton principal | V1 | Prévu |
| Course partagée entre clients | V2 | Conforme au document de référence |
| Catégorie avec animal | À arbitrer comme option (supplément) | À arbitrer |

---

## 4. Modèle des relevés envoyés aux chauffeurs

### 4.1 Relevé hebdomadaire

Modèle : le relevé Uber du 9 au 16 février 2026. Il est clair et complet, mais long (17 pages, dont 12 de transactions). Neomoov garde sa structure et l'adapte à son modèle.

| Bloc | Contenu Neomoov |
|---|---|
| En-tête | Logo, « Relevé hebdomadaire », numéro du relevé, période (du lundi 0 h 00 au dimanche 23 h 59, relevé émis le vendredi suivant à 6 h, selon la section 5.8 du cahier des charges ; Uber compte du lundi 4 h au lundi 4 h), nom du chauffeur, téléphone, courriel, numéros de TPS et de TVQ du chauffeur |
| Récapitulatif | Solde de départ. Vos revenus. Remboursements et dépenses. Événements des semaines précédentes. Versements (date, heure, montant). Solde final |
| Détail des revenus | Prix des courses (prix, annulations, rajustements, attente, frais de réservation, suppléments). **Commission Neomoov : 0,00 $**, ligne toujours affichée. Pourboires. Paiements reçus directement du client (espèces, Interac, terminal), qui viennent en déduction du versement |
| Packs | Packs activés, courses incluses, courses consommées, solde reporté, coût du pack, taxes sur le pack |
| Remboursements et dépenses | Péages remboursés. Coût des packs. Frais de versement instantané s'il existe. Taxes liées |
| Taxes et redevance | TPS et TVQ perçues sur les courses. Redevance de 0,90 $ par course, nombre de courses, total |
| Semaines précédentes | Pourboires tardifs, rajustements, remboursements |
| Journal des transactions | Traité le, événement (catégorie, heure de la course), revenus, remboursements et dépenses, versements, solde courant. Chaque ligne renvoie à sa course ou à son pack |
| Pied de page | Nom du chauffeur, page x de n, mention « Ce relevé n'est pas une facture » si c'est le cas, coordonnées de l'assistance |

Améliorations par rapport au modèle :
1. Une page de synthèse avant le journal : heures en ligne, heures au volant, courses, revenu par heure, revenu par course, comparaison avec la semaine précédente.
2. Le journal regroupé par jour, avec un sous-total quotidien.
3. Version courriel courte (le récapitulatif) avec le PDF complet en pièce jointe et un lien vers l'application.

### 4.2 Récapitulatif mensuel

Modèle : le « Récapitulatif fiscal de la période » d'Uber, deux pages.

| Bloc | Contenu Neomoov |
|---|---|
| En-tête | Logo, « Récapitulatif mensuel », période, nom du chauffeur ou de sa société, mention « Ce document n'est pas une facture ni un document fiscal officiel » |
| Prix bruts des courses | Prix des courses, frais de réservation, redevance, frais d'aéroport, péages, pourboires, TPS perçue, TVQ perçue, total |
| Montants payés à Neomoov | Packs, autres frais, rabais, TPS et TVQ payées à Neomoov (utiles pour les crédits et remboursements de taxes), total, numéros de taxes du Groupe NSK Inc. |
| Pour la déclaration de TPS et de TVQ | Fournitures hors taxes, taxes perçues, taxes remises au nom du chauffeur s'il y a lieu, numéros de taxes du chauffeur |
| Autres revenus | Primes de parrainage, divers |
| Déductions possibles | Kilomètres en course, kilomètres en ligne |
| Avertissement | Information seulement. Consulter un conseiller fiscal |

Le contenu exact du bloc des taxes dépend de la réponse à la question ouverte du point 1.4.

---

## 5. Écarts à arbitrer avec le cahier des charges

Ces points sont absents du cahier des charges v1.0. Aucun n'est ajouté au code sans arbitrage.

| N° | Point | Recommandation |
|---|---|---|
| E1 | Bon de commande et preuve de course pour un contrôle | V1. Vérifier l'exigence réglementaire exacte |
| E2 | Limite et compteur du temps de conduite | V1. Fixer la règle (12 h et 6 h de repos, ou autre) |
| E3 | Écran de répartition du prix avec « Commission Neomoov : 0,00 $ » | V1 |
| E4 | Résumé de séance | V1 |
| E5 | Borne de recharge rapide la plus proche | V1.1 |
| E6 | Mode destination | V1.1 |
| E7 | Calendrier des événements par agent IA | V1.1 |
| E8 | Vérification par NIP | V1.1 |
| E9 | Versement instantané payant | V1.1 |
| E10 | Perception et remise des taxes au nom du chauffeur | Question à un comptable avant l'étape 9 |
| E11 | Coût de la vérification des antécédents et mode de récupération | À décider avant l'ouverture des inscriptions |
| E12 | Option « avec animal » | À arbitrer |
