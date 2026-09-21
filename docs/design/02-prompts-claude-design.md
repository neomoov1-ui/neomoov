# Neomoov. Prompts pour Claude Design

Version 1.0, 22 septembre 2026. Niveau interne.

Ces prompts produisent le design des applications Neomoov dans Claude Design. Le prompt 0 s'ajoute au début de chaque autre prompt : il porte l'identité et les règles. Les prompts 1 à 6 décrivent chacun un lot d'écrans.

**État au 22 septembre 2026.** Le lot 1 est exécuté : 20 maquettes sont sur le canevas « Neomoov : design des applications » (https://claude.ai/artifact/EwhoGryiRhAWpzmR362u8z, privé). Les sources sont dans `canevas/project/`. Les prompts ci-dessous couvrent aussi les écrans restants.

**Deux façons de les exécuter.**
1. Dans Claude Code, depuis le workspace Jarvis : « Exécute le prompt N de `02-prompts-claude-design.md` sur le canevas Neomoov ». Claude ajoute les maquettes au même canevas.
2. Dans Claude Design sur claude.ai : coller le prompt 0 puis le prompt voulu.

**Règle de confidentialité.** Ne jamais joindre les captures Uber ni les relevés : ils contiennent des renseignements personnels de tiers. Les prompts décrivent les principes à reprendre, cela suffit.

---

## Prompt 0. Identité et règles communes (à coller avant chaque prompt)

```
Tu conçois les interfaces de Neomoov, un service de transport de personnes par
véhicules 100 % électriques à Montréal. Promesse : le modèle de véhicule affiché
est celui qui arrive, le prix est fixe et tout compris, sans majoration de pointe,
et les chauffeurs ne paient aucune commission (ils achètent des packs de courses).
Signature : « Avancez vers demain. »

IDENTITÉ
- Couleurs : bleu profond #0B3D91 (action principale, marque), bleu #1F6FBF
  (liens, graphiques, trajet), vert #3DBE6B (en ligne, prise en charge, succès),
  encre #0A1B33 (texte), gris #4A5A70 (texte secondaire), filet #DCE3EC,
  fond #F4F7FB, alerte #C62828 (SOS, destination, erreur).
- États : approuvé #E3F6EA sur #14602F, en attente #FFF1D6 sur #7A4B00,
  nouveau #E4EEFB sur #0B3D91, action requise #FDE7E7 sur #9B1C1C.
- Dégradé bleu profond vers bleu vers vert : accents seulement (logo, barres de
  progression, anneau de sélection). Jamais sous du texte blanc.
- Mode sombre : fond #071426, surface #0E2038, filet #1E3554, texte #F2F6FB,
  secondaire #A9B8CC. Écrans d'accueil en sombre.
- Typographie : Inter. Montants 44 px graisse 800, titre de page 32 px graisse
  800, section 20 px graisse 700, texte 16 px, secondaire 14 px, rien sous 13 px.
- Logo : mot « neomoov » en minuscules. Utiliser le logo fourni s'il est joint,
  sinon un emplacement provisoire.

PRINCIPES D'ERGONOMIE
- Carte d'abord : la carte occupe le haut de l'écran, le contenu vit dans une
  feuille à coins arrondis (22 px) qui monte du bas.
- Une seule action principale par écran : bouton pleine largeur en bas,
  56 px de haut, rayon 14 px, fond #0B3D91, texte blanc.
- Début et fin de course : bouton à glisser, jamais un simple appui.
- Offre de course : le bouton « Accepter » se remplit pendant le compte à rebours.
- Listes : pictogramme, titre, description grise, chevron, séparateur fin.
- Cartes : rayon 16 px, bordure 1 px #DCE3EC, presque pas d'ombre.
- Repères de carte : vert pour la prise en charge, rouge pour la destination.
- Barre de cinq onglets en bas. Cibles tactiles de 44 px au minimum, 56 px pour
  le chauffeur, qui utilise l'application au volant d'une seule main.
- Pictogrammes au trait, 2 px. Aucun émoji. Aucune fausse barre d'état.

CONTENU
- Français du Québec. Formats : 12,35 $, 5 h 45, lundi 14 septembre, 8,2 km.
- Le prix client est toujours tout compris, avec un détail dépliable : tarif,
  frais de service 2,00 $, redevance gouvernementale 0,90 $, TPS, TVQ.
  Jamais de prix barré ni de promotion affichée en rouge.
- Côté chauffeur, montrer « Commission Neomoov : 0,00 $ » partout où il est
  question d'argent.
- Catégories : Neo Premium (4 places, exemple Tesla Model 3), Neo Prestige
  (4 places, exemple Tesla Model S), Neo XL (6 places, exemple Kia EV9).
- Grille : Premium 3,75 $ + 1,70 $ par km + 0,40 $ par minute, minimum 9,50 $.
  Prestige 4,75 $ + 2,10 $ + 0,50 $, minimum 12,00 $. XL 5,00 $ + 2,30 $ +
  0,55 $, minimum 13,00 $. Forfaits aéroport : 55 $, 69 $, 75 $ tout compris.
  Exemple de contrôle : 8 km et 18 minutes en Premium donnent 24,55 $ de tarif
  et 31,56 $ affichés.
- Packs : Découverte 10 courses 29 $, Essentiel 25 courses 59 $, Pro 50 courses
  99 $, Élite 100 courses 169 $ (quatre semaines), Illimité 199 $ par semaine.
- Données fictives seulement : aucun nom, adresse ou photo de personne réelle.
  Utiliser des lieux publics (Gare Centrale, aéroport Montréal-Trudeau).
- Ne reprendre ni l'identité, ni les textes, ni les noms de produits d'une autre
  entreprise de transport.

FORMATS
- Mobile 390 x 844. Web 1280 à 1440 de large. Documents imprimés en format
  lettre, 816 x 1056, marges de 72 px, texte de 16 px au minimum.
- Contraste de 4,5 pour 1 au minimum. Vrais boutons, vrais champs avec libellé.
```

---

## Prompt 1. Application client, écrans restants

```
Conçois les écrans restants de l'application client Neomoov (mobile, 390 x 844),
dans le style des cinq écrans déjà faits (accueil, carte, catégories, suivi, fin).

1. Code reçu par texto : six cases, renvoi du code, délai.
2. Consentements : conditions, confidentialité, localisation, marketing. Rien de
   coché par défaut sauf le nécessaire au service.
3. Recherche de destination : champ actif, suggestions, lieux enregistrés,
   ajout d'un arrêt.
4. Options de la course, en feuille : offre Flex (hors pointe, prise en charge
   jusqu'à 15 minutes, tarif réduit de 10 %), Priorité, chauffeur favori, siège
   d'enfant, bagages, réservation pour un tiers, préférences (silence ou
   discussion, température, musique). Le prix se recalcule à chaque option.
5. Mode de paiement : carte enregistrée, Apple Pay, Google Pay, Interac,
   espèces, terminal. Ajout d'une carte sans quitter l'application.
6. Recherche de chauffeur : animation sobre, temps écoulé, annulation gratuite.
7. En course : trajet, temps restant, arrêts, bouton SOS, partage du trajet.
8. Réservations planifiées : liste, création (date, heure, numéro de vol),
   détail, modification jusqu'à 30 minutes avant.
9. Historique et reçus : liste des courses, détail, facture PDF.
10. Profil : identité, langue, préférences, lieux, chauffeurs favoris, paiements,
    crédits, code de parrainage, consentements, suppression du compte.
11. Assistance : conversation avec l'agent, passage à un humain, questions
    fréquentes, numéro de téléphone.
12. États vides et erreurs : aucun chauffeur disponible, paiement refusé,
    hors zone de service, hors connexion.
```

---

## Prompt 2. Application chauffeur, écrans restants

```
Conçois les écrans restants de l'application chauffeur Neomoov (mobile, 390 x 844),
dans le style des sept écrans déjà faits (accueil, offre, attente, revenus,
planifiées, packs, documents). Le chauffeur conduit : gros caractères, gros
boutons, un seul geste par étape, version sombre pour la nuit.

1. Inscription en étapes : téléphone, identité, qualification (chauffeur
   autorisé SAAQ ou inscrit), numéros de TPS et de TVQ, véhicule, documents
   photographiés, avec une barre de progression et le statut de chaque pièce.
2. Formation : modules vidéo, quiz, attestation. Impossible de passer en ligne
   sans attestation.
3. Compte de versement : parcours d'inscription, statut, prochain versement.
4. Modes de paiement acceptés : carte dans l'application (obligatoire),
   espèces, Interac, terminal.
5. Accueil hors ligne : « Passer en ligne » en vert, prérequis vérifiés, pack
   actif, prochaine course planifiée. Variante sans pack actif : invitation à
   en activer un.
6. En route vers le client : bandeau d'adresse, distance et délai, boutons
   « Ouvrir dans Google Maps » et « Ouvrir dans Waze », appel, message, SOS.
7. Client à bord : destination, arrêts, temps restant, glisser pour terminer.
8. Arrêt en cours de route : chronomètre, revenu du temps à l'arrêt, glisser
   pour repartir.
9. Fin de course : montant, mode de paiement, confirmation du montant reçu si
   paiement direct, évaluation du client, motifs de signalement.
10. Signaler un problème : client introuvable, aucun endroit où s'arrêter,
    trop de passagers, bagages trop volumineux, mineur non accompagné, pas de
    siège d'enfant, comportement, problème de véhicule.
11. Détail d'une course : prix, carte, durée, distance, rues sans numéro,
    péage remboursé, explication d'un écart de prix, course du pack consommée.
12. Où va l'argent payé par mes clients : anneau et lignes (vous, frais de
    service, redevance, taxes), avec « Commission Neomoov : 0,00 $ ».
13. Mes réservations : course réservée à confirmer, rappel de repasser en
    ligne 30 minutes avant, annulation sans effet jusqu'à 60 minutes avant.
14. Clients fidèles : clients qui redemandent ce chauffeur, priorité.
15. Tableau de conduite : ponctualité, note avec répartition des étoiles,
    annulations sur les 100 dernières courses, conseils.
16. Sécurité : SOS avec transmission de la position, signalement d'incident,
    partage de ma position avec un proche, assistance.
17. Preuve de course à présenter lors d'un contrôle : exploitant, numéro et
    heure de la course, passager, origine, destination, chauffeur, plaque.
18. Résumé de séance : durée, revenu, courses faites et offertes.
19. Profil : identité, véhicule, langue, zones préférées, consentements.
```

---

## Prompt 3. My Hub, modules restants

```
Conçois les modules restants de My Hub, le poste de pilotage web de Neomoov
(1440 x 900), dans le style du tableau de bord déjà fait : menu sombre à gauche,
contenu clair, cartes à bordure fine, tableaux denses mais lisibles.

1. Répartition et panneau opérateur : liste des courses triée par urgence,
   création d'une course, recherche d'adresse, attribution manuelle,
   réattribution, chronologie des événements, conversation avec le chauffeur
   et le client.
2. Chauffeurs : liste filtrable, fiche (identité, statut, documents avec
   visionneuse, véhicule, packs, relevés, notes, incidents, sanctions),
   validation ou rejet d'une inscription, suspension, réactivation.
3. Véhicules : liste, conformité au standard Neomoov, inspections.
4. Clients : liste, fiche, courses, crédits, paiements masqués, consentements,
   demandes d'accès et de suppression.
5. Tarifs et zones : grille par catégorie avec dates de validité, suppléments,
   forfaits, éditeur de zones sur carte, simulation d'un devis.
6. Packs et règlements : achats, relevés de la semaine (aperçu, émission,
   versements, prélèvements, échecs), soldes, suspensions pour solde.
7. Promotions : codes, règles, budgets, utilisation, parrainages.
8. Facturation et conformité fiscale : factures, état des transmissions,
   registre de la redevance, registre des taxes, exports.
9. Incidents et sécurité : file des incidents, décisions, sanctions, registre
   des incidents de confidentialité.
10. Agents IA : liste, mode, file d'approbation, journal avec justification et
    coût, seuils.
11. Rapports : indicateurs, courbes, exports.
12. Paramètres : villes, drapeaux de fonctionnalités, gabarits de
    notifications, utilisateurs et rôles, clés masquées.
13. Connexion avec second facteur.
```

---

## Prompt 4. Pages web publiques

```
Conçois les pages web publiques de Neomoov (1280 de large, et leur version
mobile à 390), dans le style de la page de réservation déjà faite.

1. Réservation, étapes suivantes : vérification du téléphone par texto,
   paiement par carte ou au chauffeur, confirmation.
2. Détail du prix déplié : tarif, frais de service, redevance, TPS, TVQ.
3. Suivi par lien unique, sans compte : carte, chauffeur, véhicule, plaque,
   délai, bouton d'appel.
4. Suivi partagé avec un proche.
5. Inscription des chauffeurs : promesse (zéro commission, packs, revenu
   prévisible), préinscription, prise de rendez-vous de formation.
6. Statut d'une demande d'accès ou de suppression de renseignements.
```

---

## Prompt 5. Relevés et courriels aux chauffeurs

```
Complète les documents envoyés aux chauffeurs, dans le style du relevé
hebdomadaire et du récapitulatif mensuel déjà faits (format lettre).

1. Courriel du vendredi : montant versé, quatre chiffres de la semaine,
   « Commission Neomoov : 0,00 $ », lien vers l'application, PDF joint.
2. Relevé à solde négatif : montant à prélever, date, marche à suivre.
3. Rapport trimestriel pour les déclarations de taxes.
4. Facture d'une course remise au client : fournisseur du transport (le
   chauffeur et ses numéros de taxes), lignes, frais de service Neomoov avec
   ses numéros, redevance, taxes, total, mode de paiement, code QR.
5. Reçu de pourboire et avis de remboursement.
```

---

## Prompt 6. Notifications et messages

```
Conçois les gabarits de notifications de Neomoov, en français du Québec, courts
et sans jargon : push, texto et courriel.

Client : code de connexion, chauffeur attribué, chauffeur arrivé, course
terminée et reçu, réservation confirmée, rappel la veille, annulation.
Chauffeur : nouvelle offre, course planifiée à confirmer, rappel de repasser
en ligne, pack presque épuisé (3 courses restantes), pack renouvelé, document
bientôt échu, document refusé, relevé disponible, versement effectué.

Pour chaque message : titre de 40 caractères au plus, corps de 120 caractères
au plus, action proposée. Montrer le rendu sur un écran verrouillé.
```
