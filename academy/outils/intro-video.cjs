// Vidéo de bienvenue de l'espace membre (bloc 01 Introduction) : narration par voix de synthèse et diapositives, avec les
// mêmes outils que les modules (audio-serveur.sh et video-serveur.sh sur le serveur, dossier « m0 »).
// Usage : node academy/outils/intro-video.cjs texte              -> academy/livraison/formation/audio/m0/NN.txt
//         node academy/outils/intro-video.cjs slides <durees.json> -> academy/livraison/formation/video/m0/NN.png + liste.txt
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', 'livraison', 'formation');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SILENCE = 0.9;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SEQUENCES = [
  { kicker: 'Bienvenue', title: 'Bienvenue dans Neomoov Chauffeur Pro', points: ['La formation de Neomoov Academy, à Montréal.', 'Construite sur vingt ans de terrain du fondateur de Neomoov.', 'Sept modules, un examen final, une attestation vérifiable.'],
    text: 'Bienvenue dans Neomoov Chauffeur Pro, la formation de Neomoov Academy. Ce parcours a été construit à partir de vingt ans de terrain du fondateur de Neomoov à Montréal : chauffeur de taxi, chauffeur V T C, puis propriétaire de sociétés de taxi et de V T C. Il ne remplace pas la formation obligatoire au Québec. Il vous apprend à exercer mieux, une fois en règle : en sécurité, dans les règles, et avec de meilleurs résultats.' },
  { kicker: 'Votre parcours', title: 'Un espace en blocs, dans l’ordre', points: ['Le sondage de départ : cinq minutes.', 'Sept modules à lire, à écouter ou à regarder.', 'Un exercice corrigé et un quiz de cinq questions par module.', 'Quatre bonnes réponses valident le module.'],
    text: 'Votre espace membre est organisé en blocs. Commencez par le sondage de départ : cinq minutes pour nous dire d’où vous partez et ce que vous attendez. Viennent ensuite les sept modules. Chaque module se lit, s’écoute ou se regarde en vidéo, et se télécharge en P D F. Il se termine par un exercice corrigé et un quiz de cinq questions : quatre bonnes réponses valident le module, et vous pouvez le reprendre autant de fois que nécessaire.' },
  { kicker: 'Neomoov Booster', title: 'L’application qui vous suit chaque jour', points: ['Le rapport de vérification sommaire, avant la première utilisation de la journée.', 'Le rapport de performance de chaque session de travail.', 'Votre portrait de chauffeur et votre plan de travail simplifié.'],
    text: 'Neomoov Booster vous accompagne chaque jour de travail. Le rapport de vérification sommaire, exigé par la loi avant la première utilisation de la journée, se remplit sur votre téléphone et reste dans votre compte. Le rapport de performance compare le départ et l’arrivée de chaque session : heures, kilomètres, montants, solde par heure. Et votre portrait de chauffeur vous donne vos points forts, vos points à travailler, une fourchette de revenu et un plan de travail simplifié.' },
  { kicker: 'Examen et attestation', title: 'Jusqu’au programme de chauffeurs Neomoov', points: ['Examen final : vingt questions, quarante minutes, quatre-vingts pour cent.', 'Attestation de suivi avec code de vérification.', 'Véhicule cent pour cent électrique de cinq ans ou moins : candidature possible chez Neomoov.'],
    text: 'Quand les sept modules sont réussis, l’examen final s’ouvre : vingt questions tirées des modules, quarante minutes, quatre-vingts pour cent de bonnes réponses pour réussir. Votre attestation de suivi porte alors un code que tout employeur ou opérateur peut vérifier. Les meilleurs participants, qui réussissent l’examen et roulent en véhicule cent pour cent électrique de cinq ans ou moins, peuvent poser leur candidature pour devenir chauffeur Neomoov, sans garantie d’admission ni de courses.' },
  { kicker: 'À vous de jouer', title: 'Une à deux heures par module, à votre rythme', points: ['Le bloc Bonus réunit votre package gratuit.', 'Le sondage de fin nous aide à améliorer la formation.', 'neomoov.net/academy'],
    text: 'Comptez une à deux heures par module, à votre rythme, sur votre téléphone ou votre ordinateur. Le bloc Bonus réunit votre package gratuit : l’ebook, votre évaluation et votre plan. À la fin, le sondage de fin nous aidera à améliorer la formation pour les prochains chauffeurs. Bonne route, et bonne formation.' },
];

function slideHtml(s, index, total) {
  const list = s.points.length ? `<ul>${s.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
  return `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1280px;height:720px;overflow:hidden}body{font:28px/1.4 "Segoe UI",Arial,sans-serif;color:#fff;background:linear-gradient(135deg,#0a2431 0%,#10171f 60%,#163541 100%);position:relative}
.top{position:absolute;top:36px;left:60px;right:60px;display:flex;justify-content:space-between;align-items:center}.brand{font-size:34px;font-weight:800;letter-spacing:-1px}.brand span{font-size:13px;letter-spacing:5px;margin-left:10px;font-weight:700;color:#c4f45c}
.kicker{font-size:16px;letter-spacing:3px;text-transform:uppercase;color:#c4f45c;font-weight:700}.body{position:absolute;top:130px;left:60px;right:60px;bottom:70px}
h1{font-size:${index === 1 ? 56 : 46}px;line-height:1.12;margin:0 0 28px;letter-spacing:-1px;max-width:1100px}
ul{list-style:none;padding:0;margin:0;max-width:1120px}li{position:relative;padding-left:42px;margin:0 0 18px;font-size:30px;line-height:1.35}li:before{content:"";position:absolute;left:0;top:14px;width:18px;height:18px;border-radius:50%;background:#c4f45c}
.foot{position:absolute;bottom:28px;left:60px;right:60px;display:flex;justify-content:space-between;font-size:16px;color:#9fb3bd}.bar{position:absolute;bottom:0;left:0;height:8px;background:#c4f45c;width:${Math.round((index / total) * 100)}%}
</style></head><body><div class="top"><div class="brand">neomoov<span>ACADEMY</span></div><div class="kicker">${esc(s.kicker)}</div></div><div class="body"><h1>${esc(s.title)}</h1>${list}</div><div class="foot"><span>Neomoov Chauffeur Pro · bienvenue</span><span>neomoov.net/academy</span></div><div class="bar"></div></body></html>`;
}

const mode = process.argv[2];
if (mode === 'texte') {
  const dir = path.join(root, 'audio', 'm0');
  fs.mkdirSync(dir, { recursive: true });
  SEQUENCES.forEach((s, i) => fs.writeFileSync(path.join(dir, `${String(i + 1).padStart(2, '0')}.txt`), s.text + '\n'));
  console.log(`${SEQUENCES.length} séquences dans ${path.relative(process.cwd(), dir)} (${SEQUENCES.reduce((n, s) => n + s.text.split(/\s+/).length, 0)} mots)`);
} else if (mode === 'slides') {
  const durees = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const dir = path.join(root, 'video', 'm0');
  fs.mkdirSync(dir, { recursive: true });
  const list = [];
  SEQUENCES.forEach((s, i) => {
    const n = String(i + 1).padStart(2, '0');
    const html = path.join(dir, `${n}.html`);
    fs.writeFileSync(html, slideHtml(s, i + 1, SEQUENCES.length));
    const png = path.join(dir, `${n}.png`);
    if (fs.existsSync(png)) fs.unlinkSync(png);
    const profile = path.join(require('os').tmpdir(), `edge-intro-${Date.now()}`);
    execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--disable-extensions', `--user-data-dir=${profile}`, '--window-size=1280,720', `--screenshot=${png}`, 'file:///' + html.replace(/\\/g, '/')], { stdio: 'ignore', timeout: 60000 });
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    if (!fs.existsSync(png)) throw Error(`diapositive manquante : ${png}`);
    const d = durees[`m0/${n}`];
    if (typeof d !== 'number') throw Error(`durée manquante : m0/${n}`);
    list.push(`file '${n}.png'`, `duration ${(d + SILENCE).toFixed(3)}`);
  });
  list.push(`file '${String(SEQUENCES.length).padStart(2, '0')}.png'`);
  fs.writeFileSync(path.join(dir, 'liste.txt'), list.join('\n') + '\n');
  console.log(`${SEQUENCES.length} diapositives dans ${path.relative(process.cwd(), dir)}`);
} else {
  console.log('usage : node intro-video.cjs texte | slides <durees.json>');
  process.exit(2);
}
