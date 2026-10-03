#!/usr/bin/env node
/**
 * Construit les 50 publications de lancement (chantier « Réseaux sociaux » du 3 octobre 2026, agent S3) :
 * - lit les lots rédigés dans scripts/publications-lancement/lot-*.mjs (un objet par publication, un sous-objet par espace) ;
 * - compose le texte publié de chaque espace (même règle que `composeText` du domaine : légende d'abord sur les réseaux
 *   à média, puis le lien sur les réseaux à liens cliquables, puis les mots-clics) ;
 * - propose une date et une heure par espace : jour de la publication, créneau du réglage `marketing.slots` lu dans
 *   packages/db/src/seed/data.ts (heure du créneau de ce jour, sinon heure du premier créneau, comme le débordement du
 *   calendrier), 3 heures plus tard pour la deuxième publication du jour sur le même espace ;
 * - écrit docs/marketing/lancement-50-publications.json et docs/marketing/lancement-50-publications.md.
 *
 * Usage : node scripts/construire-publications.mjs [--debut=2026-10-06]
 * Puis : node scripts/verifier-publications.mjs (zéro erreur attendue).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FUSEAU = 'America/Toronto';
const DEBUT = (process.argv.find((a) => a.startsWith('--debut=')) ?? '--debut=2026-10-06').slice(8);
const DUREE_JOURS = 28;
const DECALAGE_DEUXIEME_HEURES = 3;

/** Les dix espaces, dans l'ordre du document commun (S-COMMUN-reseaux.md). */
export const ESPACES = ['site_blog', 'facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'snapchat', 'telegram', 'youtube', 'whatsapp_channel'];
export const NOMS_ESPACES = {
  site_blog: 'Blogue neomoov.net', facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X', tiktok: 'TikTok',
  snapchat: 'Snapchat', telegram: 'Telegram', youtube: 'YouTube (Short)', whatsapp_channel: 'Chaîne WhatsApp',
};
/** Format par espace (codes du domaine : `article`, `post`, `short`). */
const FORMATS = { site_blog: 'article', facebook: 'post', instagram: 'post', linkedin: 'post', x: 'post', tiktok: 'short', snapchat: 'short', telegram: 'post', youtube: 'short', whatsapp_channel: 'post' };
/** Liens cliquables dans le texte (sinon : « lien dans la bio » ou adresse écrite en clair). */
const LIENS_CLIQUABLES = { site_blog: true, facebook: true, instagram: false, linkedin: true, x: true, tiktok: false, snapchat: false, telegram: true, youtube: true, whatsapp_channel: true };

export const THEMES = {
  lancement: 'Lancement de la marque et slogan',
  aeroport: 'Service aéroport Montréal-Trudeau',
  reservation: 'Réservation 2 heures à l\'avance',
  electrique: 'Véhicules 100 % électriques',
  prix: 'Prix tout compris affiché avant',
  commodites: 'Commodités à bord',
  securite: 'Sécurité et chauffeurs vérifiés',
  entreprises: 'Entreprises et comptes d\'affaires',
  chauffeurs: 'Devenir chauffeur',
  academy: 'Neomoov Academy et Chauffeur Pro',
  quartiers: 'Quartiers et saisons de Montréal',
  conseils: 'Conseils de déplacement',
  coulisses: 'Coulisses',
};
export const SUJETS_PHOTO = { aeroport: 'Aéroport', vehicule: 'Véhicule électrique', chauffeur: 'Chauffeur', ville: 'Ville', client: 'Client' };

/** Appels à l'action : adresses réservées (prompt S3) ; `member` correspond à la cible `academy` du domaine, avec l'adresse de l'espace gratuit. */
export const ADRESSES = {
  reserve: 'https://neomoov.net/reserver',
  academy: 'https://neomoov.net/academy',
  preregister: 'https://neomoov.net/chauffeurs/#candidature',
  member: 'https://neomoov.net/academy/inscription/',
};
const CTA_DOMAINE = { reserve: 'reserve', academy: 'academy', preregister: 'preregister', member: 'academy' };

/** Créneaux de Telegram et de la chaîne WhatsApp : absents du réglage actuel, proposés ici (à confirmer avec l'agent S2). */
const CRENEAUX_PROPOSES = {
  telegram: [{ day: 1, time: '08:00' }],
  whatsapp_channel: [{ day: 1, time: '17:30' }],
};

/** Réglage `marketing.slots` tel qu'il est écrit dans le fichier d'amorçage de la base (objet littéral évalué). */
export function lireCreneaux() {
  const source = readFileSync(join(RACINE, 'packages/db/src/seed/data.ts'), 'utf8');
  const debut = source.indexOf('key: \'marketing.slots\'');
  if (debut < 0) throw new Error('Réglage marketing.slots introuvable dans packages/db/src/seed/data.ts');
  const valeur = source.indexOf('value:', debut);
  let i = source.indexOf('{', valeur);
  let profondeur = 0;
  let fin = i;
  for (; fin < source.length; fin += 1) {
    if (source[fin] === '{') profondeur += 1;
    if (source[fin] === '}') profondeur -= 1;
    if (profondeur === 0) break;
  }
  const creneaux = new Function(`return (${source.slice(i, fin + 1)});`)();
  return { ...CRENEAUX_PROPOSES, ...creneaux };
}

/** Heure locale du créneau d'un espace pour un jour de semaine (1 = lundi) : créneau de ce jour, sinon premier créneau. */
export function heureDuCreneau(creneaux, espace, jourSemaine) {
  const liste = [...(creneaux[espace] ?? [])].sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
  if (!liste.length) throw new Error(`Aucun créneau pour ${espace}`);
  return (liste.find((c) => c.day === jourSemaine) ?? liste[0]).time;
}

export function decalerDate(date, jours) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

export function jourSemaine(date) {
  const j = new Date(`${date}T12:00:00Z`).getUTCDay();
  return j === 0 ? 7 : j;
}

/** Date et heure locales de Montréal avec leur décalage (heure avancée ou normale selon la date), au format ISO. */
export function horodatage(date, heure) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = heure.split(':').map(Number);
  const essai = Date.UTC(y, m - 1, d, hh, mm);
  const decalage = (instant) => {
    const nom = new Intl.DateTimeFormat('en-US', { timeZone: FUSEAU, timeZoneName: 'longOffset' }).formatToParts(new Date(instant)).find((p) => p.type === 'timeZoneName').value;
    const r = /GMT([+-])(\d{2}):(\d{2})/.exec(nom);
    return r ? (r[1] === '-' ? -1 : 1) * (Number(r[2]) * 60 + Number(r[3])) : 0;
  };
  const minutes = decalage(essai - decalage(essai) * 60_000);
  const signe = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${date}T${heure}:00${signe}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function ajouterHeures(heure, n) {
  const [hh, mm] = heure.split(':').map(Number);
  return `${String(Math.min(hh + n, 23)).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const joindre = (...parties) => parties.filter((p) => p && String(p).trim()).map((p) => String(p).trim()).join('\n\n');

/** Texte publié tel que le réseau le reçoit (règle de `composeText` du domaine, étendue à Telegram et à la chaîne WhatsApp). */
export function composer(espace, principal, lien, motsClics) {
  const avecLien = LIENS_CLIQUABLES[espace] && lien && !principal.includes(lien) ? lien : null;
  return joindre(principal, avecLien, motsClics?.length ? motsClics.join(' ') : null);
}

const compterMots = (texte) => texte.split(/\s+/).filter((m) => /[\p{L}\p{N}]/u.test(m)).length;

/** Une publication rédigée (forme courte des lots) devient l'objet publié : un sous-objet complet par espace. */
function construirePublication(p, creneaux, rangs) {
  const date = decalerDate(DEBUT, p.jour);
  const lien = p.lien ?? ADRESSES[p.cta];
  const js = jourSemaine(date);
  const programme = (espace) => {
    const cle = `${date}|${espace}`;
    const rang = rangs.get(cle) ?? 0;
    rangs.set(cle, rang + 1);
    return horodatage(date, ajouterHeures(heureDuCreneau(creneaux, espace, js), rang * DECALAGE_DEUXIEME_HEURES));
  };
  const base = (espace) => ({ inclus: true, format: FORMATS[espace], langue: 'fr', titreImage: p.img[espace], programmeLe: programme(espace) });
  const espaces = {};

  espaces.site_blog = p.blog
    ? (() => {
        const e = base('site_blog');
        const texteComplet = composer('site_blog', p.blog.corps, lien, []);
        return { ...e, titre: p.blog.titre, extrait: p.blog.extrait, corps: p.blog.corps.trim(), motsClics: [], texteComplet, longueur: texteComplet.length, mots: compterMots(p.blog.corps) };
      })()
    : { inclus: false, raison: 'Blogue réservé à 9 des 50 publications (un ou deux articles par semaine, lignes éditoriales).' };

  {
    const [corps, motsClics = []] = p.fb;
    const texteComplet = composer('facebook', corps, lien, motsClics);
    espaces.facebook = { ...base('facebook'), corps: corps.trim(), motsClics, texteComplet, longueur: texteComplet.length };
  }
  {
    const [legende, motsClics] = p.ig;
    const texteComplet = composer('instagram', legende, lien, motsClics);
    espaces.instagram = { ...base('instagram'), legende: legende.trim(), motsClics, texteComplet, longueur: texteComplet.length };
  }
  {
    const [corps, corpsEn, motsClics = []] = p.li;
    const texteComplet = composer('linkedin', joindre(corps, corpsEn), lien, motsClics);
    espaces.linkedin = { ...base('linkedin'), langue: 'fr+en', corps: corps.trim(), corpsEn: corpsEn.trim(), motsClics, texteComplet, longueur: texteComplet.length };
  }
  {
    const [corps, corpsEn, motsClics = [], motsClicsEn] = p.x;
    const texteComplet = composer('x', corps, lien, motsClics);
    const texteCompletEn = composer('x', corpsEn, lien, motsClicsEn ?? motsClics);
    espaces.x = { ...base('x'), langue: 'fr+en', corps: corps.trim(), corpsEn: corpsEn.trim(), motsClics, motsClicsEn: motsClicsEn ?? motsClics, texteComplet, longueur: texteComplet.length, texteCompletEn, longueurEn: texteCompletEn.length, note: 'Deux publications : la française, puis l\'anglaise en réponse ou juste après.' };
  }
  for (const [espace, cle] of [['tiktok', 'tt'], ['snapchat', 'sc']]) {
    const [sequences, legende, motsClics] = p[cle];
    const texteComplet = composer(espace, legende, lien, motsClics);
    espaces[espace] = { ...base(espace), sequences, legende: legende.trim(), motsClics, texteComplet, longueur: texteComplet.length };
  }
  {
    const [corps] = [p.tg];
    const texteComplet = composer('telegram', corps, lien, []);
    espaces.telegram = { ...base('telegram'), corps: corps.trim(), motsClics: [], texteComplet, longueur: texteComplet.length };
  }
  {
    const [titre, sequences, description, motsClics] = p.yt;
    const texteComplet = composer('youtube', description, lien, motsClics);
    espaces.youtube = { ...base('youtube'), titre, sequences, description: description.trim(), motsClics, texteComplet, longueur: texteComplet.length };
  }
  {
    const texteComplet = composer('whatsapp_channel', p.wa, lien, []);
    espaces.whatsapp_channel = { ...base('whatsapp_channel'), corps: p.wa.trim(), motsClics: [], texteComplet, longueur: texteComplet.length, note: 'Relais manuel : aucune API officielle de publication sur une chaîne WhatsApp.' };
  }

  return {
    numero: p.n,
    code: `P${String(p.n).padStart(2, '0')}`,
    theme: p.theme,
    themeLibelle: THEMES[p.theme],
    sujet: p.sujet,
    date,
    jourSemaine: js,
    photo: { sujet: p.photo[0], sujetLibelle: SUJETS_PHOTO[p.photo[0]], indication: p.photo[1], regle: 'Photo réelle de la médiathèque, créditée (règle D46) ; jamais d\'image de synthèse présentée comme une photo. Recadrage propre à chaque réseau (dimensions de l\'espace), titre d\'image différent par réseau.' },
    cta: p.cta,
    ctaDomaine: CTA_DOMAINE[p.cta],
    lien,
    approbationHumaine: Boolean(p.sensible),
    motifApprobation: p.sensible ?? null,
    espaces: Object.fromEntries(ESPACES.map((e) => [e, espaces[e]])),
  };
}

async function chargerLots() {
  const dossier = join(RACINE, 'scripts/publications-lancement');
  const fichiers = readdirSync(dossier).filter((f) => /^lot-\d+\.mjs$/.test(f)).sort();
  const lots = [];
  for (const f of fichiers) lots.push(...(await import(pathToFileURL(join(dossier, f)).href)).default);
  return lots.sort((a, b) => a.n - b.n);
}

const JOURS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dateLongue = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${JOURS[jourSemaine(date)]} ${d === 1 ? '1er' : d} ${MOIS[m - 1]} ${y}`;
};
const heureLisible = (iso) => iso.slice(11, 16).replace(':', ' h ');
const citer = (texte) => texte.split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n');

function markdown(doc) {
  const l = [];
  l.push('# Lancement de Neomoov : les 50 premières publications (10 espaces)');
  l.push('');
  l.push(`Document généré par \`node scripts/construire-publications.mjs\` à partir des lots \`scripts/publications-lancement/lot-*.mjs\` ; vérifié par \`node scripts/verifier-publications.mjs\`. Données complètes : \`docs/marketing/lancement-50-publications.json\`. Rédaction du ${doc.redigeLe}, à valider par le fondateur avant toute programmation.`);
  l.push('');
  l.push(`Période proposée : du ${dateLongue(doc.debut)} au ${dateLongue(doc.fin)} (4 semaines, heure de Montréal), 1 à 3 publications par jour. Chaque publication a un texte propre à chaque réseau, un titre d'image différent par réseau et une indication de photo réelle (règle D46). Le blogue ne reçoit que ${doc.publications.filter((p) => p.espaces.site_blog.inclus).length} articles (un ou deux par semaine, comme le prévoient les lignes éditoriales).`);
  l.push('');
  l.push('Règles appliquées : lignes éditoriales v1.1 (vouvoiement, français du Québec d\'abord, anglais seulement sur LinkedIn et X après le français, aucun tiret long, emoji seulement sur Instagram, TikTok et Snapchat, au plus un sur Telegram et la chaîne WhatsApp) ; seuls prix : 48,20 $ (forfait aéroport Neo Premium depuis le centre-ville) et 113,83 $ (Neomoov Chauffeur Pro) ; aucune promesse de revenu, aucun concurrent, aucune donnée personnelle, rien sur la commission ; numéros publics +1 438 900 4990 et +1 438 805-7974 seulement.');
  l.push('');
  l.push('## Calendrier');
  l.push('');
  l.push('| N° | Date proposée | Thème | Sujet | Réseaux | Photo réelle | Approbation |');
  l.push('|---|---|---|---|---|---|---|');
  for (const p of doc.publications) {
    const reseaux = ESPACES.filter((e) => p.espaces[e].inclus).length === 10 ? 'les 10 (blogue compris)' : '9 (sans le blogue)';
    l.push(`| ${p.code} | ${dateLongue(p.date)} | ${p.themeLibelle} | ${p.sujet} | ${reseaux} | ${p.photo.sujetLibelle} | ${p.approbationHumaine ? 'humaine requise' : 'standard'} |`);
  }
  l.push('');
  l.push('## Créneaux utilisés (heure de Montréal)');
  l.push('');
  l.push('Réglage `marketing.slots` (packages/db/src/seed/data.ts) : heure du créneau du jour de la publication, sinon heure du premier créneau de l\'espace (débordement du calendrier) ; la deuxième publication du même jour sur un espace part 3 heures plus tard. Telegram (8 h) et la chaîne WhatsApp (17 h 30) n\'ont pas encore de créneau dans le réglage : heures proposées, à confirmer.');
  l.push('');
  l.push('| Espace | Créneaux |');
  l.push('|---|---|');
  for (const e of ESPACES) l.push(`| ${NOMS_ESPACES[e]} | ${(doc.creneaux[e] ?? []).map((c) => `${JOURS[c.day]} ${c.time.replace(':', ' h ')}`).join(', ')} |`);
  l.push('');
  l.push('## Publications');
  for (const p of doc.publications) {
    l.push('');
    l.push(`### ${p.code} · ${dateLongue(p.date)} · ${p.themeLibelle} · ${p.sujet}`);
    l.push('');
    l.push(`- Photo réelle (${p.photo.sujetLibelle.toLowerCase()}) : ${p.photo.indication}`);
    l.push(`- Appel à l'action : ${p.lien}`);
    if (p.approbationHumaine) l.push(`- Approbation humaine requise : ${p.motifApprobation}`);
    for (const e of ESPACES) {
      const s = p.espaces[e];
      if (!s.inclus) continue;
      l.push('');
      l.push(`#### ${NOMS_ESPACES[e]} · ${heureLisible(s.programmeLe)} · titre d'image : « ${s.titreImage} »`);
      l.push('');
      if (e === 'site_blog') {
        l.push(`**${s.titre}** (${s.mots} mots)`);
        l.push('');
        l.push(`Extrait : ${s.extrait}`);
        l.push('');
        l.push(citer(s.texteComplet));
      } else if (e === 'x') {
        l.push(citer(s.texteComplet));
        l.push('');
        l.push(`Version anglaise (${s.longueurEn} caractères) :`);
        l.push('');
        l.push(citer(s.texteCompletEn));
      } else if (s.sequences) {
        if (s.titre) l.push(`Titre : ${s.titre}`);
        l.push('');
        l.push('Séquences de la vidéo :');
        l.push('');
        s.sequences.forEach((q, i) => l.push(`${i + 1}. ${q}`));
        l.push('');
        l.push(e === 'youtube' ? 'Description :' : 'Légende :');
        l.push('');
        l.push(citer(s.texteComplet));
      } else {
        l.push(citer(s.texteComplet));
      }
    }
  }
  l.push('');
  return l.join('\n');
}

async function principal() {
  const creneaux = lireCreneaux();
  const lots = await chargerLots();
  const rangs = new Map();
  const ordre = [...lots].sort((a, b) => a.jour - b.jour || a.n - b.n);
  const construites = new Map(ordre.map((p) => [p.n, construirePublication(p, creneaux, rangs)]));
  const doc = {
    version: 1,
    nom: 'Lancement de Neomoov : 50 premières publications',
    redigeLe: '2026-10-03',
    fuseau: FUSEAU,
    debut: DEBUT,
    fin: decalerDate(DEBUT, DUREE_JOURS - 1),
    espaces: ESPACES,
    regles: {
      lignesEditoriales: 'docs/marketing/lignes-editoriales.md (v1.1, 3 octobre 2026)',
      prixAutorises: ['48,20 $', '113,83 $'],
      numerosPublics: ['+1 438 900 4990', '+1 438 805-7974'],
      adresses: ADRESSES,
      themes: THEMES,
    },
    creneaux: Object.fromEntries(ESPACES.map((e) => [e, creneaux[e] ?? []])),
    publications: lots.map((p) => construites.get(p.n)),
  };
  writeFileSync(join(RACINE, 'docs/marketing/lancement-50-publications.json'), `${JSON.stringify(doc, null, 2)}\n`);
  writeFileSync(join(RACINE, 'docs/marketing/lancement-50-publications.md'), markdown(doc));
  console.log(`${doc.publications.length} publications écrites (du ${doc.debut} au ${doc.fin}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await principal();
