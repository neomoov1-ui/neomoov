// Narration des 7 modules : un fichier texte par séquence (introduction, sections, exercice, conclusion), prêt pour la
// voix de synthèse (chiffres, unités et sigles écrits pour être lus), et un manifeste pour l'assemblage audio et vidéo.
// Usage : node academy/outils/narration.cjs   (sortie : academy/livraison/formation/audio/mN/NN.txt + manifest.json)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'livraison', 'formation');
const out = path.join(root, 'audio');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8').replace(/^﻿/, ''));

/* Écriture « à lire » : montants, unités, sigles courants et abréviations. */
function spoken(text) {
  return String(text)
    .replace(/\s*\n\s*-\s+/g, '. ')         // listes : chaque élément devient une phrase
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s*;\s*/g, ', ')
    .replace(/(\d)\s(\d{3})\b/g, '$1$2')     // 60 000 → 60000
    .replace(/(\d+),(\d+)\s*\$/g, '$1 dollars $2')   // 0,75 $ → 0 dollars 75
    .replace(/(\d+)\s*\$/g, '$1 dollars')
    .replace(/\$ CA\b/g, 'dollars canadiens')
    .replace(/(\d+)\s*%/g, '$1 pour cent')
    .replace(/(\d+)\s*km\b/g, '$1 kilomètres')
    .replace(/\bkm\b/g, 'kilomètres')
    .replace(/(\d+)\s*h\b/g, '$1 heures')
    .replace(/\b(\d+)\s*cm\b/g, '$1 centimètres')
    .replace(/\b1er\b/g, 'premier')
    .replace(/\bn°\s*/g, 'numéro ')
    .replace(/\bTPS\b/g, 'T P S').replace(/\bTVQ\b/g, 'T V Q').replace(/\bSAAQ\b/g, 'S A A Q').replace(/\bCTQ\b/g, 'C T Q')
    .replace(/\bVTC\b/g, 'V T C').replace(/\bYUL\b/g, 'Y U L').replace(/\bPDF\b/g, 'P D F').replace(/\bGPS\b/g, 'G P S')
    .replace(/\bUSB-C\b/g, 'U S B C').replace(/\bmicro-USB\b/g, 'micro U S B').replace(/\bUSB\b/g, 'U S B')
    .replace(/\bCAI\b/g, 'C A I').replace(/\bCDPDJ\b/g, 'C D P D J').replace(/\bRLRQ\b/g, 'R L R Q').replace(/\bNCP\b/g, 'N C P')
    .replace(/\bc\. T-11\.2(, r\. 1)?\b/g, 'chapitre T 11 point 2')
    .replace(/\bart\.\s*/g, 'article ')
    .replace(/\bex\.\s*/g, 'par exemple ')
    .replace(/«\s*|\s*»/g, '"')
    .replace(/\s*:\s*/g, ' : ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const manifest = [];
data.lessons.forEach((l, i) => {
  const n = i + 1;
  const dir = path.join(out, `m${n}`);
  fs.mkdirSync(dir, { recursive: true });
  const title = l.title.replace(/^\d+\.\s*/, '');
  const parts = [];
  parts.push({ kind: 'intro', title, text: `Neomoov Chauffeur Pro, la formation de Neomoov Academy. Module ${n} : ${title}. ${l.intro}` });
  for (const s of l.sections) parts.push({ kind: 'section', title: s.title, text: `${s.title}. ${s.text}` });
  parts.push({ kind: 'exercise', title: 'Exercice', text: `Exercice. ${l.exercise} Prenez un instant pour réfléchir avant d'écouter le corrigé. Corrigé. ${l.answer}` });
  parts.push({ kind: 'outro', title: 'Quiz et attestation', text: `Vous avez terminé le module ${n}. Rendez-vous dans votre espace membre, sur neomoov point net, pour répondre au quiz de ce module : quatre bonnes réponses sur cinq le valident. Les sept modules réussis donnent droit à votre attestation de suivi. Merci, et bonne route.` });
  const entries = parts.map((p, j) => {
    const file = `${String(j + 1).padStart(2, '0')}.txt`;
    fs.writeFileSync(path.join(dir, file), spoken(p.text) + '\n');
    return { file, kind: p.kind, title: p.title, chars: spoken(p.text).length };
  });
  manifest.push({ module: n, id: l.id, title, parts: entries });
});
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const chars = manifest.reduce((a, m) => a + m.parts.reduce((b, p) => b + p.chars, 0), 0);
console.log(`${manifest.length} modules, ${manifest.reduce((a, m) => a + m.parts.length, 0)} séquences, ${chars} caractères (≈ ${Math.round(chars / 14 / 60)} min de narration)`);
