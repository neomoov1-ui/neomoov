# Étape 22 : écrans de la marque par organisation (description)

Captures à prendre avec une organisation de démonstration (par exemple « Taxi Alpha », couleur principale `#123456`) une fois le poste moins chargé ; convention des dossiers `client/`, `driver/` et `hub/` : `NN-nom.png`.

## Application client (`client/`)

- **16-accueil-marque** : accueil avec le logo de l'organisation (sinon celui de Neomoov), son nom commercial en titre, sa signature, « Propulsé par Neomoov » ; pastilles de langue à la couleur principale. Sans organisation : écran inchangé.
- **17-rejoindre-organisation** : écran « Rejoindre une organisation » (Profil, bouton du même nom, ou lien `https://neomoov.net/c/<code>`) : champ du code (8 lettres et chiffres), aperçu de la marque dès que le code est complet (pastille de la couleur principale, nom, signature), bouton « Rejoindre » ; sans session, avis « Connectez-vous… », le code est gardé et l'écran revient après la connexion.
- **18-rejoindre-reussi** : message « Vous êtes maintenant rattaché à Taxi Alpha. », bouton « Continuer » ; l'application prend aussitôt les couleurs de la marque (boutons, onglet actif, fond).
- **19-profil-organisation** : section « Mon organisation » du profil : organisation actuelle, ou sélecteur si l'utilisateur en a plusieurs ; bouton « Rejoindre une organisation ».
- **20-assistance-marque** : écran Assistance avec « Appeler Taxi Alpha » et « Écrire à Taxi Alpha » (coordonnées de l'assistance de la marque).

## Application chauffeur (`driver/`)

- Mêmes écrans que le client (accueil, rejoindre, profil « Mon organisation », assistance) ; l'écran « Rejoindre » porte une note : le code affiche la marque, conduire pour la flotte passe par une invitation de l'organisation.

## Web (`hub/` et pages publiques)

- **Réservation sous le domaine d'une organisation** (`/reserver`) : en-tête au nom ou au logo de la marque, boutons et liens à sa couleur principale, fond et texte de la marque, conditions et politique de la marque dans l'étape des coordonnées ; titre de l'onglet « Réserver une course · Taxi Alpha ».
- **Connexion à My Hub** (`/hub/connexion`) : nom ou logo de la marque au-dessus du formulaire, titre « My Hub Taxi Alpha » ; cadre de My Hub au nom de la marque.
- **Page du code** (`/c/<code>`) : carte de la marque (logo ou initiale, nom, signature), marche à suivre dans l'application, code en évidence, lien vers la réservation web ; code inconnu : message d'erreur.
