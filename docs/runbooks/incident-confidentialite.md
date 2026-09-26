# Incident de confidentialité (Loi 25)

Étape 16. Procédure à suivre quand Neomoov a des raisons de croire qu'un renseignement personnel qu'elle détient a été consulté, utilisé, communiqué ou perdu sans autorisation. Références : Loi sur la protection des renseignements personnels dans le secteur privé (articles 3.5 à 3.8) et Règlement sur les incidents de confidentialité. Ce manuel est une aide d'exploitation, **pas un avis juridique** : le faire relire par l'avocat, et l'appeler dès qu'un incident paraît sérieux.

Responsable de la protection des renseignements personnels : le fondateur, tant qu'aucune autre personne n'est désignée (`docs/privacy/efvp.md`). La loi exige de le consulter pour l'évaluation du risque.

## 1. Qu'est-ce qui est un incident

- Accès non autorisé : compte du personnel utilisé par un tiers, fuite d'un export, document de chauffeur ouvert par une personne non habilitée.
- Utilisation ou communication non autorisée : message envoyé au mauvais destinataire (facture, relevé, lien de suivi, export Loi 25), agent IA qui révèle une donnée d'un autre client.
- Perte : téléphone ou ordinateur du personnel perdu avec une session ouverte, suppression accidentelle.
- Toute autre atteinte à la protection : vulnérabilité exploitée, clé ou secret divulgué, incident chez un fournisseur (Supabase, Stripe, Twilio, Resend, Anthropic, Vapi, Meta, Expo) qui touche nos données.

Données les plus sensibles chez Neomoov : positions des chauffeurs, adresses des courses, documents d'identité, permis et antécédents des chauffeurs, numéros de TPS et TVQ, messages, et plus tard les enregistrements à bord.

## 2. Délais

La loi n'impose pas un nombre d'heures : les avis se font « avec diligence » dès que le risque de préjudice sérieux est établi. Objectifs internes proposés (à valider) :

| Étape | Objectif interne |
|---|---|
| Contenir (section 3) | Immédiatement, dans l'heure |
| Inscrire au registre (section 4) | Le jour même |
| Évaluer le préjudice (section 5) | Sous 48 heures |
| Aviser la CAI et les personnes, si le risque est sérieux (section 6) | Sous 72 heures après l'évaluation, sans attendre d'avoir tous les détails (un complément peut suivre) |
| Conserver l'inscription au registre | Au moins 5 ans après la date où Neomoov a pris connaissance de l'incident |

## 3. Contenir (dans l'heure)

Selon la cause :

| Cause | Geste | Manuel |
|---|---|---|
| Compte du personnel compromis | Remplacer le mot de passe (révoque ses sessions) et réinitialiser son second facteur | `personnel-my-hub.md`, section 4 |
| Clé ou secret divulgué | Rotation immédiate | `secrets-et-cles.md` |
| Clé de service (`nmk_…`) exposée | Révocation (`DELETE /v1/admin/api-keys/{id}`) | `personnel-my-hub.md`, section 5 |
| Agent IA en cause | Agent en mode `manual` ou inactif | `drapeaux-et-reglages.md`, section 2 |
| Serveur compromis | Couper l'accès (arrêter les services), garder les journaux, appeler l'avocat avant toute remise en état | `redemarrer-un-service.md` |
| Envoi au mauvais destinataire | Demander au destinataire de supprimer et de confirmer par écrit ; révoquer le lien s'il est signé (les liens d'export expirent en 7 jours, ceux des relevés en 10 minutes) | |
| Incident chez un fournisseur | Obtenir son avis écrit (nature, données, dates, mesures) ; appliquer ses recommandations | |

Conserver les preuves : ne rien effacer. Exporter le journal d'audit de la période (`GET /v1/admin/audit/export`, administrateur ; aucun bouton d'export dans l'écran **Journal d'audit** pour l'instant) et les journaux du serveur (`docker compose -f infra/compose.prod.yml logs --since 48h api > /root/incident-AAAAMMJJ.log`).

## 4. Inscrire au registre (le jour même)

Tout incident, même sans risque sérieux, est inscrit. Le règlement demande, pour chaque incident :

| Rubrique | À inscrire |
|---|---|
| Renseignements concernés | Description, ou raisons pour lesquelles on ne peut pas encore les décrire |
| Circonstances | Brève description de ce qui s'est passé et de la cause si elle est connue |
| Date ou période de l'incident | Même approximative |
| Date ou période où Neomoov en a pris connaissance | |
| Nombre de personnes concernées | Même approximatif ; dont au Québec |
| Évaluation du risque | Éléments de la section 5 et conclusion (sérieux ou non) |
| Avis | Si le risque est sérieux : dates de transmission à la CAI et aux personnes, avis public éventuel et sa raison |
| Mesures | Mesures prises pour réduire le risque et éviter un nouvel incident |

**Où tenir le registre.** My Hub a un filtre « Registre des incidents de confidentialité » (Sécurité et conformité, **Incidents**), qui lit la colonne `incidents.privacy_breach` ; mais **aucun écran ni aucune route de l'API n'écrit encore cette colonne**, et un incident ne peut pas être créé depuis My Hub. Signalé comme manque au code. En attendant : tenir le registre dans un document confidentiel hors du dépôt (par exemple une note sécurisée Bitwarden « Registre des incidents de confidentialité », ou un fichier dans `C:\Users\PC\cles-neomoov\`), une entrée par incident avec les rubriques ci-dessus, et ne jamais le verser dans Git (il contient des renseignements personnels). Le reporter dans My Hub quand l'écran existera.

La CAI peut demander une copie du registre à tout moment.

## 5. Évaluer le risque de préjudice sérieux (sous 48 heures)

Avec le responsable de la protection des renseignements personnels, considérer :

| Critère | Questions |
|---|---|
| Sensibilité | Documents d'identité, antécédents, positions précises, données financières, santé (mobilité réduite indiquée dans les préférences), mineurs ? |
| Conséquences appréhendées | Vol d'identité, fraude, atteinte à la réputation, harcèlement ou menace physique (adresse du domicile, trajets réguliers), perte financière, discrimination |
| Probabilité de mauvaise utilisation | Données chiffrées ou non (les champs sensibles sont chiffrés en base), destinataire connu et de bonne foi ou inconnu, données déjà diffusées, intention malveillante, durée d'exposition |

Conclusion écrite au registre : risque sérieux (section 6) ou non (fin de la procédure, registre seulement).

## 6. Aviser (si le risque est sérieux)

### Commission d'accès à l'information (CAI)

Par le formulaire de déclaration d'incident de confidentialité publié sur le site de la CAI (https://www.cai.gouv.qc.ca, à vérifier au moment de l'incident). Contenu exigé par le règlement :

- nom de l'entreprise et numéro d'entreprise du Québec (NEQ) ;
- nom et coordonnées de la personne à joindre ;
- renseignements concernés (ou raisons de ne pas pouvoir les décrire) ;
- brève description des circonstances et de la cause si elle est connue ;
- date ou période de l'incident, date ou période de la prise de connaissance ;
- nombre de personnes concernées, dont au Québec (même approximatif) ;
- éléments qui font conclure à un risque de préjudice sérieux ;
- mesures prises ou prévues pour aviser les personnes, avec les dates ;
- mesures prises ou prévues pour réduire le risque ;
- le cas échéant, autres autorités ou organismes avisés (hors Québec).

Tout élément nouveau appris après l'avis est transmis à la CAI.

### Personnes concernées

Avis direct (courriel ou texto depuis les outils habituels, rédigé à la main, jamais par un agent IA), en français ou en anglais selon la langue du compte, contenant :

- les renseignements concernés ;
- une brève description des circonstances ;
- la date ou la période de l'incident ;
- les mesures prises ou prévues pour réduire le risque ;
- les mesures que la personne peut prendre elle-même (changer un mot de passe ailleurs, surveiller son dossier de crédit, se méfier d'appels frauduleux) ;
- les coordonnées pour obtenir plus d'information.

Un avis public (site neomoov.net, publication) remplace l'avis direct seulement si l'avis direct risque de causer un préjudice accru, est trop difficile, ou si les coordonnées manquent. L'avis aux personnes peut être différé si l'aviser risque d'entraver une enquête menée par une autorité chargée de prévenir ou de réprimer les crimes : à décider avec l'avocat.

### Autres personnes

Neomoov peut aviser une personne ou un organisme capable de réduire le risque (banque, fournisseur, police), en ne communiquant que les renseignements nécessaires ; l'inscrire au registre.

### Autres régimes (à confirmer par l'avocat)

Si la loi fédérale (LPRPDE) s'applique aussi à l'activité en cause, une déclaration au Commissariat à la protection de la vie privée du Canada peut être exigée, avec ses propres règles de registre.

## 7. Après l'incident

- Corriger la cause (code, réglage, formation du personnel) et noter la mesure au registre.
- Mettre à jour l'EFVP (`docs/privacy/efvp.md`) si l'incident révèle un risque non prévu.
- Revue à 30 jours : la mesure a-t-elle tenu ?

## Modèle d'entrée de registre (à copier hors du dépôt)

```
Numéro : IC-AAAA-NNN
Date ou période de l'incident :
Date de prise de connaissance :
Signalé par :
Renseignements concernés :
Circonstances et cause :
Nombre de personnes (dont au Québec) :
Mesures de confinement (date, heure) :
Évaluation du risque (sensibilité, conséquences, probabilité) :
Conclusion : risque sérieux oui / non ; consulté : (responsable PRP)
Avis à la CAI : date, référence
Avis aux personnes : date, moyen ; avis public : oui / non, raison
Autres avis (police, fournisseur, autorités hors Québec) :
Mesures correctives :
Revue à 30 jours :
```
