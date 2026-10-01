$ErrorActionPreference = 'Stop'
$videoRoot = $PSScriptRoot
$curriculum = Get-Content -LiteralPath (Join-Path $videoRoot 'data.json') -Raw -Encoding utf8 | ConvertFrom-Json
$hooks = @(
    'Un client vous demande une course directe. Vous avez son numéro, une voiture et une application. Est-ce que cela suffit pour commencer ? Avant de répondre, organisons les bonnes vérifications.',
    'Vous avez beaucoup roulé aujourd''hui, mais vous ne savez pas où votre temps est passé. Le problème ne se trouve pas forcément pendant les courses. Regardons aussi ce qui se passe entre elles.',
    'Votre relevé affiche deux cent soixante-dix dollars. Est-ce votre bénéfice ? Pour répondre, il faut commencer par donner le bon nom à chaque chiffre.',
    'Imaginez que vous montiez à l''arrière de votre propre voiture comme un nouveau client. Que voyez-vous en premier ? Le rangement, la propreté et le confort se préparent. Mais une belle apparence ne prouve pas l''état mécanique.',
    'Un excellent service ne commence pas avec un cadeau. Il commence lorsque le client sait où vous retrouver, comprend ce qui va se passer et se sent respecté.',
    'Une retenue apparaît sur votre relevé, ou une discussion se tend avec un passager. Votre meilleure réponse commence par deux priorités : la sécurité des personnes, puis les faits.',
    'Vous voulez améliorer votre activité ou préparer un projet de transport. Au lieu de tout changer demain, nous allons construire un test simple sur trente jours.'
)
$closes = @(
    'Votre action aujourd''hui : ouvrez la fiche Débuter au Québec et identifiez un seul point encore à confirmer. Trouvez la bonne source, notez votre prochaine démarche et sa date. Vous avancez dès que votre dossier devient plus clair.',
    'Votre action aujourd''hui : remplissez le bilan de journée et choisissez une seule perte de temps à examiner. Demain, testez une modification simple. Mesurez le travail réel, puis décidez avec vos observations.',
    'Votre action aujourd''hui : prenez un relevé réel, identifiez ce qui est déjà inclus et nommez correctement vos trois indicateurs. Le bilan de journée vous sert de support. Des chiffres utiles commencent par des définitions cohérentes.',
    'Votre action aujourd''hui : prenez cinq minutes à l''arrêt pour observer l''espace passager, corriger un problème de rangement et vérifier une consigne dans le manuel de votre véhicule. Le kit du bon chauffeur vous aide à prioriser.',
    'Votre action aujourd''hui : choisissez un message de prise en charge et une question de confort. Utilisez-les au bon moment, sans automatiser la relation. Un service constant se construit avec des gestes simples.',
    'Votre action aujourd''hui : préparez une fiche incident vierge et rangez un relevé récent pour pouvoir le retrouver. Vous n''avez pas besoin d''attendre un conflit pour construire une procédure claire.',
    'Votre action aujourd''hui : ouvrez le plan trente jours et écrivez votre problème, votre indicateur et votre première semaine d''observation. Vous n''avez pas besoin d''une promesse spectaculaire. Vous avez besoin d''un test que vous pouvez réellement suivre.'
)
$visuals = @(
    @('Présentateur face caméra. Carton : Une demande de course ne suffit pas à valider un dossier.', 'Schéma simple : chauffeur → véhicule → canal → territoire. Ajouter propriétaire / locataire / salarié.', 'Trois colonnes : exigences officielles, conditions opérateur, bonnes pratiques. Placer une icône de tablette uniquement dans la troisième.', 'Capture fictive d''un dossier de fichiers et d''un calendrier. Toutes les données sont factices.', 'Téléphone professionnel posé à côté d''un carnet. Carton : vérifier avant de proposer un nouveau service.', 'Question à l''écran avec quatre éléments à classer. Laisser un bref temps de réflexion.', 'Réponse en trois couleurs, sans utiliser de logo officiel ni simuler un agrément.', 'Montrer la fiche Débuter au Québec. Appel à l''action : une vérification aujourd''hui.'),
    @('Présentateur et frise d''une journée sans chiffres de gains spectaculaires.', 'Frise : préparation, approche, attente, course, repositionnement, énergie, administration. Une seule horloge pour deux applications.', 'Comparaison de deux observations fictives. Étiquette visible : exemple pédagogique.', 'Plan dessiné d''une entrée et d''un point de rencontre permis, sans prétendre reproduire une rue réelle.', 'Carnet avec un problème et une action. Aucun plan de saisie de téléphone en conduisant.', 'Afficher 8 h à 16 h ; pause 30 min ; deux connexions qui se chevauchent.', 'Afficher 7 h 30 de travail ; les deux temps de connexion ne s''additionnent pas.', 'Fiche bilan de journée, ligne Une amélioration demain mise en évidence.'),
    @('Relevé fictif portant la mention 270 CAD. Question : recettes ou bénéfice ?', 'Trois cases : prix client, relevé chauffeur, versement. Flèche sur frais déjà retenus.', 'Deux dénominateurs : temps total professionnel et kilomètres totaux professionnels.', 'Liste de coûts encore absents. Barrer le libellé bénéfice net et afficher solde après dépenses saisies.', 'Deux journées fictives comparées avec météo, durée et contexte. Pas de graphique de revenus promis.', 'Afficher le cas : 270 CAD ; 9 h ; 225 km ; 40 CAD énergie.', 'Afficher les trois résultats : 30 CAD/h ; 1,20 CAD/km ; 230 CAD après énergie. Mention autres coûts non inclus.', 'Gros plan sur une ligne de relevé fictif et les intitulés des indicateurs.'),
    @('Plan fixe du véhicule stationné, vu depuis la place arrière. Aucun véhicule filmé en conduite.', 'Illustrer un rangement propre avec ceintures et accès dégagés. Ne pas montrer de démontage ou contrôle mécanique.', 'Mouchoirs rangés, eau fermée et câble immobilisé. Option facultative sur tablette et cadeaux.', 'Écran partagé : amélioration visible / aptitude mécanique non démontrée. Mention photo ≠ diagnostic.', 'Deux colonnes : recharge planifiée / ravitaillement planifié ; référence commune au manuel du constructeur exact.', 'Photo fictive ou dessin : câble au sol, mouchoirs, voyant stylisé sans diagnostic.', 'Flèches : ranger, nettoyer, identifier le voyant avec le manuel et obtenir l''aide appropriée.', 'Checklist kit chauffeur avec trois priorités entourées.'),
    @('Présentateur. Carton : clarté, fiabilité, respect.', 'Jeu de rôle véhicule stationné : salut, confirmation, destination, préférence de confort.', 'Bulle de réponse neutre à une question tarifaire. Reçu fictif sans données personnelles.', 'Question visible : Comment souhaitez-vous que je vous aide ? Respecter le consentement avant toute aide.', 'Objet oublié fictif sur une banquette, puis illustration d''un signalement via le canal prévu.', 'À l''écran : Le prix est plus haut que prévu. Prévoir deux secondes de pause au montage.', 'Afficher la réponse du corrigé sans promesse de remboursement.', 'Fiche prise en charge et guide passagers, sans demander un avis positif.'),
    @('Présentateur calme. Deux mots : sécurité, faits.', 'Illustration abstraite de mise en sécurité. Ne pas rejouer une agression réaliste ni filmer une confrontation.', 'Trois colonnes : observé / rapporté / à vérifier. Une chronologie factice.', 'Dossier protégé avec reçu, relevé et messages. Données masquées.', 'Modèle de réclamation : référence, fait, pièce, demande. Journal de relance fictif.', 'Retenue fictive sur un relevé avec références génériques.', 'Quatre lignes du message corrigé. Carton : pas de données passager dans une publication publique.', 'Fiche incident vierge puis dossier de rangement accessible au seul responsable.'),
    @('Présentateur et calendrier de trente jours.', 'Un problème vague devient un problème observable : rencontres confuses à une entrée.', 'Une seule modification entourée. Autres variables du contexte consignées en marge.', 'Carte des responsabilités : véhicule, planning, entretien, paiement, support. Tous les noms sont génériques.', 'Trois choix : adopter, adapter, abandonner. Aucun rendement chiffré promis.', 'Exercice à l''écran : indicateur, modification, contexte, critère de décision.', 'Frise : semaine 1 observer ; ensuite tester ; fin du mois décider.', 'Plan trente jours vierge. Mention : exercices complémentaires, aucun agrément réglementaire.')
)
$transitions = @('Commençons par la base. ', 'Passons à la méthode. ', 'Voici maintenant le point de vigilance. ', 'Et voici comment appliquer cela au quotidien. ')
$allVideos = [System.Collections.Generic.List[object]]::new()
$combined = [System.Text.StringBuilder]::new()
[void]$combined.AppendLine("# CAP CHAUFFEUR — Sept scripts vidéo prêts à tourner`n")
[void]$combined.AppendLine('Neomoov Academy · Montréal · Version du 29 septembre 2026')
[void]$combined.AppendLine("`n**Statut : scripts écrits uniquement. Aucune vidéo ni voix enregistrée ou générée.** Les durées ci-dessous sont des estimations non mesurées, calculées à 135 mots/minute. Prévoir les respirations, les pauses des exercices et ajuster après lecture réelle. Aucune durée finale n'est certifiée.`n")
for ($i=0; $i -lt $curriculum.lessons.Count; $i++) {
    $lesson = $curriculum.lessons[$i]
    $narrations = [System.Collections.Generic.List[string]]::new()
    $narrations.Add($hooks[$i])
    for ($j=0; $j -lt $lesson.sections.Count; $j++) { $narrations.Add($transitions[$j]+$lesson.sections[$j].text) }
    $narrations.Add('À vous de jouer. '+$lesson.exercise+' Vous pouvez mettre la vidéo en pause pour préparer votre réponse.')
    $narrations.Add('Voici une correction possible. '+$lesson.answer)
    $narrations.Add($closes[$i])
    $segments = [System.Collections.Generic.List[object]]::new()
    $wordCount = 0
    $script = [System.Text.StringBuilder]::new()
    [void]$script.AppendLine('# '+$lesson.title)
    [void]$script.AppendLine("`n## Note de production`n")
    [void]$script.AppendLine('Script narrateur intégral, adapté du parcours écrit CAP CHAUFFEUR. Tourner le présentateur dans un endroit calme et filmer les démonstrations uniquement véhicule stationné. Plans suggérés réalisables avec téléphone, captures fictives et fiches fournies. Ne pas montrer de coordonnées, plaques ou visages de clients réels sans autorisation appropriée.')
    [void]$script.AppendLine("`nLa colonne des visuels constitue une proposition de montage, pas une vidéo existante. Les indications de durée sont prévisionnelles et non mesurées. Les exercices peuvent nécessiter une pause volontaire du spectateur.`n")
    for ($k=0; $k -lt $narrations.Count; $k++) {
        $words = ($narrations[$k] -split '\s+' | Where-Object {$_}).Count
        $secs = [Math]::Round($words / 135.0 * 60)
        $wordCount += $words
        $segments.Add([pscustomobject]@{scene=$k+1;estimated_seconds=$secs;visual=$visuals[$i][$k];narration=$narrations[$k]})
        [void]$script.AppendLine("`n## Séquence "+($k+1)+" — environ $secs secondes de parole, non mesurées`n")
        [void]$script.AppendLine('**Visuel / réalisation :** '+$visuals[$i][$k])
        [void]$script.AppendLine("`n**Texte narrateur — à dire intégralement :**`n`n"+$narrations[$k])
    }
    $secondsTotal = [Math]::Round($wordCount / 135.0 * 60)
    $minTotal = [Math]::Floor($secondsTotal/60)
    $remainingSeconds = $secondsTotal%60
    [void]$script.AppendLine("`n## Durée et vérification avant enregistrement`n`n$wordCount mots de narration ; environ $minTotal min $remainingSeconds s à 135 mots/minute, avant ajout des pauses. Estimation non mesurée. Lire une fois à voix haute, vérifier la prononciation des nombres et de CAD, puis enregistrer. Ne pas accélérer une explication pour atteindre artificiellement la durée cible.")
    [void]$script.AppendLine("`n**Écran final :** CAP CHAUFFEUR · Neomoov Academy · Retrouvez la fiche pratique dans votre espace membre. Formation complémentaire ; aucun permis ni revenu garanti.")
    $filename = ('SCRIPT_VIDEO_{0:00}_{1}.md' -f ($i+1),$lesson.id)
    [System.IO.File]::WriteAllText((Join-Path $videoRoot $filename),$script.ToString(),[System.Text.UTF8Encoding]::new($false))
    [void]$combined.AppendLine("`n---`n`n"+$script.ToString())
    $allVideos.Add([pscustomobject]@{id=$lesson.id;title=$lesson.title;status='script_only_not_recorded';word_count=$wordCount;duration_estimate_seconds=$secondsTotal;duration_measured=$false;assumed_words_per_minute=135;scenes=$segments})
}
[void]$combined.AppendLine("`n## Traçabilité`n`nLes contenus sont dérivés des sept leçons du fichier data.json. Leur traçabilité détaillée et les limites réglementaires figurent dans SOURCES_ET_PERIMETRE.md. La matrice de couverture est disponible dans MATRICE_COUVERTURE_ET_DIFFERENCIATION.md. Ces scripts ne créent aucune fonction logicielle et ne démontrent aucune supériorité actuelle sur un concurrent.")
[System.IO.File]::WriteAllText((Join-Path $videoRoot 'CAP_CHAUFFEUR_7_SCRIPTS_VIDEO.md'),$combined.ToString(),[System.Text.UTF8Encoding]::new($false))
$videoPayload = [pscustomobject]@{brand='Neomoov Academy';product='CAP CHAUFFEUR';status='Scripts uniquement, aucune vidéo produite';videos=$allVideos}
[System.IO.File]::WriteAllText((Join-Path $videoRoot 'scripts-video.json'),($videoPayload | ConvertTo-Json -Depth 10),[System.Text.UTF8Encoding]::new($false))
$allVideos | Select-Object title,word_count,duration_estimate_seconds
