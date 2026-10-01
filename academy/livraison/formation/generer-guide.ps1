$ErrorActionPreference = 'Stop'
$formationRoot = $PSScriptRoot
$content = Get-Content -LiteralPath (Join-Path $formationRoot 'data.json') -Raw -Encoding utf8 | ConvertFrom-Json
function Escape-Html([string]$value) { [System.Net.WebUtility]::HtmlEncode($value) }
$html = [System.Text.StringBuilder]::new()
$md = [System.Text.StringBuilder]::new()
[void]$html.Append(@'
<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CAP CHAUFFEUR — Guide pratique | Neomoov Academy</title><style>
:root{--ink:#152b3b;--green:#0a7565;--paper:#f4f7f6}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:980px;margin:0 auto;background:#fff;padding:48px 60px}header{border-bottom:5px solid var(--green);padding-bottom:32px;margin-bottom:32px}.eyebrow{color:var(--green);font-size:13px;font-weight:750;letter-spacing:2px;text-transform:uppercase}h1{font-size:48px;line-height:1.08;letter-spacing:-1px;margin:12px 0 22px}h2{font-size:29px;line-height:1.25;color:var(--green)}h3{font-size:20px;line-height:1.3;margin-top:28px}.intro{font-size:18px}nav{padding:20px 26px;background:var(--paper);border-radius:10px}nav a{display:block;margin:6px 0}a{color:#065b72;overflow-wrap:anywhere}.card{border:1px solid #d5e3df;padding:20px 24px;margin:24px 0;border-radius:8px}.answer{background:#edf7f3;border-left:4px solid var(--green);padding:16px 22px;margin:20px 0}.label{display:block;color:var(--green);font-weight:750;font-size:13px;letter-spacing:.8px;text-transform:uppercase}.lesson,.resource{margin-top:56px;padding-top:12px;border-top:1px solid #dae3e1}li{margin:10px 0}.note{font-size:14px;color:#536570}.write{border-bottom:1px solid #b9cbc5;height:34px}.actions{position:sticky;top:0;text-align:right;max-width:980px;margin:auto;padding:8px 16px;background:#f4f7f6e8}button{background:var(--green);color:white;padding:10px 16px;border:0;border-radius:5px;font:inherit;cursor:pointer}footer{margin-top:60px;padding-top:24px;border-top:2px solid var(--green);font-size:14px}@media(max-width:640px){main{padding:25px 22px}h1{font-size:37px}h2{font-size:25px}}@media print{@page{size:A4;margin:18mm}body{font-size:10.5pt;line-height:1.5;background:white}main{padding:0;max-width:none}.actions{display:none}h1{font-size:32pt}h2{font-size:20pt}h3{font-size:13pt}nav{font-size:10pt}.lesson,.resource{break-before:page;margin-top:0}.card,.answer,h2,h3{break-inside:avoid}h2,h3{break-after:avoid}a{color:inherit}footer{break-before:page}}
</style></head><body><div class="actions"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div><main><header><div class="eyebrow">Neomoov Academy · Montréal</div><h1>CAP CHAUFFEUR</h1><p class="intro">Mieux organiser sa journée. Mieux accueillir. Décider avec des faits.</p><p>7 microleçons écrites · 8 outils pratiques · Exercices corrigés</p><p class="note">Première édition écrite — 29 septembre 2026. Formation professionnelle complémentaire : aucune autorisation, certification réglementaire ou garantie de revenu n'est délivrée. Les vidéos ne font pas partie de ce guide.</p></header><nav aria-label="Sommaire"><strong>Votre parcours</strong>
'@)
[void]$md.AppendLine('# CAP CHAUFFEUR — Neomoov Academy')
[void]$md.AppendLine("`nMontréal · Première édition écrite · 29 septembre 2026`n")
[void]$md.AppendLine('Sept microleçons, huit outils pratiques et leurs exercices corrigés. Formation professionnelle complémentaire : aucune autorisation, certification réglementaire ou garantie de revenu. Ce guide ne comprend pas de vidéos et ne représente pas les 21 heures envisagées dans le programme de travail.')
foreach ($lesson in $content.lessons) { [void]$html.Append('<a href="#'+(Escape-Html $lesson.id)+'">'+(Escape-Html $lesson.title)+'</a>') }
[void]$html.Append('<a href="#outils">Les huit outils pratiques</a><a href="#sources">Sources et périmètre</a></nav>')
foreach ($lesson in $content.lessons) {
    [void]$html.Append('<article class="lesson" id="'+(Escape-Html $lesson.id)+'"><h2>'+(Escape-Html $lesson.title)+'</h2><p class="intro">'+(Escape-Html $lesson.intro)+'</p>')
    [void]$md.AppendLine("`n## " + $lesson.title + "`n`n" + $lesson.intro)
    foreach ($section in $lesson.sections) {
        [void]$html.Append('<h3>'+(Escape-Html $section.title)+'</h3><p>'+(Escape-Html $section.text)+'</p>')
        [void]$md.AppendLine("`n### " + $section.title + "`n`n" + $section.text)
    }
    [void]$html.Append('<div class="card"><span class="label">À vous de jouer</span><p>'+(Escape-Html $lesson.exercise)+'</p><div class="write"></div><div class="write"></div></div><div class="answer"><span class="label">Correction</span><p>'+(Escape-Html $lesson.answer)+'</p></div></article>')
    [void]$md.AppendLine("`n**Exercice**`n`n"+$lesson.exercise+"`n`n**Correction**`n`n"+$lesson.answer)
}
[void]$html.Append('<section id="outils"><h2>Vos huit outils pratiques</h2><p>Copiez ou imprimez les fiches utiles. Les champs sont à compléter dans votre carnet ou votre outil de travail ; aucune donnée n&apos;est envoyée depuis ce guide.</p></section>')
[void]$md.AppendLine("`n# Les huit outils pratiques`n")
foreach ($resource in $content.resources) {
    [void]$html.Append('<article class="resource" id="'+(Escape-Html $resource.id)+'"><h2>'+(Escape-Html $resource.title)+'</h2><p class="intro">'+(Escape-Html $resource.intro)+'</p><ol>')
    [void]$md.AppendLine("`n## " + $resource.title + "`n`n" + $resource.intro+"`n")
    $stepIndex=1
    foreach ($step in $resource.steps) {
        [void]$html.Append('<li>'+(Escape-Html $step)+'</li>')
        [void]$md.AppendLine([string]$stepIndex+'. '+$step)
        $stepIndex++
    }
    [void]$html.Append('</ol><div class="card"><span class="label">Application</span><p>'+(Escape-Html $resource.exercise)+'</p><div class="write"></div></div><div class="answer"><span class="label">Exemple corrigé</span><p>'+(Escape-Html $resource.example)+'</p></div></article>')
    [void]$md.AppendLine("`n**Application**`n`n"+$resource.exercise+"`n`n**Exemple corrigé**`n`n"+$resource.example)
}
$sources = @(
    @('SAAQ — Chauffeur qualifié','https://saaq.gouv.qc.ca/transport-personnes/transport-remunere-personne-automobile/chauffeur'),
    @('SAAQ — Véhicule qualifié','https://saaq.gouv.qc.ca/transport-personnes/transport-remunere-personne-automobile/proprietaire'),
    @('CTQ — Chauffeur qualifié','https://www.ctq.gouv.qc.ca/permis-et-autorisations-de-transport/transport-remunere-de-personnes-par-automobile/chauffeur-qualifie/'),
    @('Revenu Québec — Transport rémunéré','https://www.revenuquebec.ca/fr/une-mission-des-actions/assurer-la-conformite-fiscale/evasion-fiscale/secteur-du-transport-remunere-de-personnes/')
)
[void]$html.Append('<footer id="sources"><h2>Sources et périmètre</h2><p>Ce guide reformule les six documents de référence transmis par Neomoov : les deux rapports de veille (44ea6c20 et 5f9643e8), le programme chauffeurs, la version de travail compilée, la récupération de matière originale et la retranscription du fondateur. Leurs propositions ne sont pas assimilées à des obligations vérifiées ni à des fonctions déjà disponibles.</p><p>Références officielles consultées le 29 septembre 2026 :</p><ul>')
foreach ($source in $sources) { [void]$html.Append('<li><a href="'+(Escape-Html $source[1])+'">'+(Escape-Html $source[0])+'</a></li>') }
[void]$html.Append('</ul><p>Les recommandations de propreté et de rangement ne constituent pas un diagnostic mécanique. Consultez le manuel du constructeur du véhicule exact pour son usage et son entretien. Les exemples de gestion sont fictifs, en CAD, et ne calculent ni taxes ni bénéfice comptable. Les règles propres à votre situation et à votre opérateur doivent être vérifiées séparément.</p><p>Neomoov · 204 rue du Saint-Sacrement, Montréal · <a href="mailto:contact@neomoov.net">contact@neomoov.net</a></p></footer></main></body></html>')
[void]$md.AppendLine("`n# Sources et périmètre`n")
[void]$md.AppendLine((Get-Content -LiteralPath (Join-Path $formationRoot 'SOURCES_ET_PERIMETRE.md') -Raw -Encoding utf8))
[System.IO.File]::WriteAllText((Join-Path $formationRoot 'CAP_CHAUFFEUR_GUIDE.html'),$html.ToString(),[System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText((Join-Path $formationRoot 'CAP_CHAUFFEUR_GUIDE.md'),$md.ToString(),[System.Text.UTF8Encoding]::new($false))
Write-Output 'Guide HTML et Markdown générés.'
