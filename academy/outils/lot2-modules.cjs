// Lot 2 (1er octobre 2026) : remplace les 7 leçons de data.json par les modules m1 à m7,
// renomme le compagnon web en « Neomoov Chauffeur Pro » et aligne la fiche du kit sur le module 4.
// Usage : node academy/outils/lot2-modules.cjs   (rejouable : le résultat est identique)
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'livraison', 'formation');
const file = path.join(dir, 'data.json');
const raw = fs.readFileSync(file, 'utf8');
const bom = raw.startsWith('﻿');
const data = JSON.parse(raw.replace(/^﻿/, ''));
const indent = (raw.match(/\n( +)"/) || [, '  '])[1].length;

const renames = [
  ["Le compagnon web de Neomoov Academy vous propose une fiche de vérification datée, à remplir sur votre téléphone et à enregistrer en PDF ou imprimer.",
   "L'application Neomoov Chauffeur Pro, incluse avec la formation, vous propose une fiche de vérification datée, à remplir sur votre téléphone puis à imprimer ou à enregistrer en PDF."],
  ["Le bilan de journée du compagnon web fait ce calcul pour vous.",
   "Le bilan de journée de Neomoov Chauffeur Pro fait ce calcul pour vous."],
  ["Le compagnon web de Neomoov Academy calcule votre recette par heure et par kilomètre ; l'application qui accompagne la formation centralisera ces suivis. En attendant, un simple tableur suffit, à condition de le remplir chaque jour à l'arrêt.",
   "Neomoov Chauffeur Pro, l'application incluse avec la formation, calcule votre recette par heure et par kilomètre et conserve vos bilans ; elle réunira progressivement tous vos suivis. Un simple tableur fonctionne aussi, à condition de le remplir chaque jour à l'arrêt."],
];

// Place la bonne réponse à une position stable mais variée (calculée sur le texte de la question),
// pour qu'elle ne soit pas toujours au même rang. Rejouable : la position cible ne dépend pas de l'ordre actuel.
function placeAnswer(q) {
  const target = [...q.q].reduce((s, ch) => s + ch.codePointAt(0), 0) % q.choices.length;
  const right = q.choices[q.answer];
  const others = q.choices.filter((_, i) => i !== q.answer);
  others.splice(target, 0, right);
  return { ...q, choices: others, answer: target };
}

const lessons = [1, 2, 3, 4, 5, 6, 7].map((n) => {
  const f = path.join(dir, 'modules', `m${n}.json`);
  let text = fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
  for (const [from, to] of renames) text = text.split(from).join(to);
  if (/compagnon/i.test(text)) throw Error(`m${n} : mention du compagnon restante`);
  const m = JSON.parse(text);
  m.quiz = m.quiz.map(placeAnswer);
  const quizJson = m.quiz.map((q) => '    ' + JSON.stringify(q)).join(',\n');
  text = text.replace(/("quiz": \[\n)[\s\S]*?(\n  \],\n  "sources")/, (_, a, b) => a + quizJson + b);
  if (JSON.stringify(JSON.parse(text).quiz) !== JSON.stringify(m.quiz)) throw Error(`m${n} : réécriture du quiz`);
  fs.writeFileSync(f, text);
  return m;
});

for (const [i, l] of lessons.entries()) {
  for (const k of ['id', 'title', 'intro', 'sections', 'exercise', 'answer', 'quiz', 'sources']) {
    if (!l[k] || (Array.isArray(l[k]) && !l[k].length)) throw Error(`${l.id || i} : champ ${k} manquant`);
  }
  if (!/^[a-z0-9-]+$/.test(l.id)) throw Error(`${l.id} : identifiant invalide`);
  if (!l.title.startsWith(`${i + 1}. `)) throw Error(`${l.id} : numéro de titre`);
  if (l.quiz.length !== 5) throw Error(`${l.id} : 5 questions attendues`);
  l.quiz.forEach((q, j) => {
    if (!q.q || !Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 9 || !q.explain) throw Error(`${l.id} quiz ${j}`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) throw Error(`${l.id} quiz ${j} : réponse`);
  });
  l.sources.forEach((s) => { if (!/^https:\/\//.test(s.url) || !s.label) throw Error(`${l.id} : source`); });
}
if (new Set(lessons.map((l) => l.id)).size !== 7) throw Error('identifiants en double');
data.lessons = lessons;

const kit = data.resources.find((r) => r.id === 'kit-chauffeur');
if (!kit) throw Error('fiche kit-chauffeur absente');
Object.assign(kit, {
  title: "Le kit du bon chauffeur : utile avant luxueux",
  intro: "Le kit que recommande le fondateur de Neomoov, construit en vingt ans de métier à partir de ce que les clients demandent le plus. Constituez-le dans cet ordre, au rythme de votre budget.",
  steps: [
    "Priorité 1 — La base : habitacle propre et aéré, objets libres retirés, ceintures et coffre dégagés. Aucun accessoire ne doit gêner un airbag, la visibilité ou une commande.",
    "Priorité 2 — Des organisateurs de siège fixés aux appuie-têtes avant : ils présentent l'eau, les mouchoirs et les accessoires à portée des passagers, plutôt que dans les portières.",
    "Priorité 3 — L'essentiel à bord : eau en bouteilles fermées, mouchoirs, petit sac pour les déchets, bonbons ou gomme emballés individuellement, proposés sans insister. Pensez aux allergies et aux enfants.",
    "Priorité 4 — La charge : trois câbles en bon état, Lightning (iPhone), USB-C et micro-USB, testés chaque semaine. Remplacez tout câble abîmé.",
    "Pour votre poste de conduite : un support de téléphone fixe, des lunettes de soleil sobres pour la conduite de jour (jamais la nuit), une tablette de travail et un numéro professionnel dédié.",
    "L'ambiance : nettoyez et aérez d'abord ; une senteur légère et discrète vient ensuite, jamais un parfum puissant.",
    "Budget plafond : ____ ; besoin observé : ____ ; accessoire retenu : ____ ; emplacement sécurisé : ____ ; date de réévaluation : ____.",
  ],
  exercise: "Votre budget de départ est de 80 $. Vous hésitez entre une tablette d'occasion, un parfum puissant et des organisateurs de siège avec eau, mouchoirs et trois câbles de charge. Que choisissez-vous en premier ?",
  example: "Commencez par les organisateurs de siège, l'eau, les mouchoirs et les trois câbles testés : ce sont les attentions que les clients remarquent le plus. La tablette viendra ensuite. Un parfum puissant ne règle pas une cause d'odeur et peut incommoder.",
});

fs.writeFileSync(file, (bom ? '﻿' : '') + JSON.stringify(data, null, indent) + '\n');
const words = lessons.reduce((n, l) => n + [l.intro, ...l.sections.map((s) => s.title + ' ' + s.text), l.exercise, l.answer].join(' ').split(/\s+/).length, 0);
console.log(`data.json : ${lessons.length} modules, ${lessons.reduce((n, l) => n + l.quiz.length, 0)} questions, ${words} mots ; ${data.resources.length} fiches.`);
