# Authentification Brevo de neomoov.net — préparation LWS

Valeurs affichées par Brevo le 29 septembre 2026. Les trois ajouts sont effectués dans LWS après connexion du propriétaire et autorisation explicite. Brevo a confirmé « Votre domaine a été authentifié ». Ces valeurs DNS sont destinées à être publiques ; aucune clé API n’est contenue ici.

| Type | Nom relatif à neomoov.net | Valeur |
|---|---|---|
| TXT | @ | brevo-code:e22f6c53c0a37b5fc329c17a3e7150b6 |
| CNAME | brevo1._domainkey | b1.neomoov-net.dkim.brevo.com |
| CNAME | brevo2._domainkey | b2.neomoov-net.dkim.brevo.com |

La zone existante a été lue sur ses deux pages et conservée dans `neomoov-dns-avant-brevo-page1.txt` et `neomoov-dns-avant-brevo-page2.txt`. Aucun enregistrement existant ne portait les noms Brevo. Ajouts avec TTL 1 heure et valeurs CNAME absolues terminées par un point dans LWS. Aucun enregistrement existant n’a été modifié.

Lecture DNS publique effectuée : `_dmarc.neomoov.net` répond `v=DMARC1; p=quarantine;`. Conserver cette politique. L’assistant Brevo propose `p=none` et une adresse de rapports Brevo : cette suggestion n’est pas retenue, car elle affaiblirait la politique et ajouterait un destinataire de rapports.

Le TXT SPF existant est `v=spf1 mx:neomoov.net a:mail.neomoov.net a:mailphp.lws-hosting.com -all`. Conserver ce TXT, les MX et les autres réglages de réception. Les étapes présentes ne demandent aucun changement SPF.

Après ajout, une lecture DNS publique a confirmé le TXT et les deux CNAME attendus, ainsi que le DMARC `p=quarantine` inchangé. Les quatre contrôles Brevo ont indiqué une concordance, puis l’authentification a été confirmée. Preuves : `../brevo-dns-lws-ajoutes.png` et `../brevo-domaine-authentifie.png`. Brevo annonce que la propagation complète peut prendre jusqu’à 48 heures. L’expéditeur contact@neomoov.net est depuis vérifié (preuve `../brevo-expediteur-professionnel-verifie.png`) et la migration des 28 modèles inactifs est confirmée (preuve `../brevo-28-modeles-professionnels.png`). Les quatre scénarios ont chacun sept actions enregistrées avec cet expéditeur et restent inactifs ; Autorisation reçue : une demande de test Brevo unique a été effectuée ; livraison et réception non confirmées, aucun renvoi. Les quatre scénarios restent inactifs et aucune campagne commerciale n’a été envoyée.


## Dernière recette publique et mobile

**Dernier contrôle public, après déploiement : 30 septembre 2026 à 01:12:14 UTC.** Les douze routes contrôlées répondent en HTTP 200, sans erreur PHP visible ni ancien lien Square. Les cinq pages d’offre affichent le total cohérent de 113,83 $ CA ; membre et formation demandent toujours une connexion au visiteur anonyme. Contrôle en lecture seule : aucune inscription ni aucun paiement soumis. Le contrôle précédent des cinq offres à 21:19 UTC le 29 septembre était également sans régression.

**Accueil à 390 pixels CSS : structure contrôlée sans débordement.** Le contrôle DOM communiqué par le responsable de l’intégration mesure une largeur et une largeur défilable de 390 pixels CSS, sans débordement des en-têtes, titres, paragraphes, boutons/CTA et champs inspectés. L’image principale débute à 875 px, sous le CTA (bas à 737 px) et le texte (bas à 825 px) : aucun chevauchement mesuré. La découpe initiale provenait du zoom de l’outil ; une largeur demandée de 335 pixels physiques a produit les 390 pixels CSS mesurés. Captures : `livraison/academy-mobile-layout-controle.png` et `livraison/academy-mobile-390.png` (chemins depuis la racine). La capture recadrée conserve un artefact de zoom : aucune validation visuelle de toutes les routes mobiles n’est revendiquée. Une revue sur de vrais téléphones reste conseillée.

Autorisation reçue : une demande de test Brevo unique a été effectuée ; livraison et réception non confirmées, aucun renvoi. Les quatre scénarios restent inactifs et aucune campagne commerciale n’a été envoyée.


## Test Brevo unique autorisé — résultat non confirmé

Après autorisation explicite, le bouton « Envoyer le test » a été cliqué une seule fois pour R01, message d’automatisation 29, de contact@neomoov.net vers le seul destinataire neomoov1@gmail.com. Le bouton s’est désactivé pendant le traitement puis est redevenu disponible. Aucun succès ni erreur explicite n’a été capturé ; les zones d’alerte et de statut étaient vides. La page Transactionnel / Logs affichait zéro journal pour le 23–30 septembre, mais elle peut ne pas couvrir ce test marketing : cela ne prouve pas un échec. La réception a été demandée à l’utilisateur et reste non confirmée. Aucun renvoi effectué. La capture `livraison/brevo-test-r01-envoi.png` montre seulement l’interface après la demande, pas une confirmation de livraison. Les quatre scénarios restent inactifs ; aucune campagne commerciale ni ajout de contact n’a été effectué.
