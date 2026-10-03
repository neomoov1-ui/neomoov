#!/usr/bin/env node
/**
 * Construit les 50 publications de lancement (chantier « Réseaux sociaux » du 3 octobre 2026, agent S3) :
 * - lit les lots rédigés dans scripts/publications-lancement/lot-*.mjs (un objet par publication, un sous-objet par espace) ;
 * - écrit docs/marketing/lancement-50-publications.json au format d'import de My Hub
 *   (docs/marketing/lancement-50-publications.schema.json de l'agent S2) : une variante par réseau, script vidéo à raison
 *   d'une séquence par ligne, titre d'image propre à chaque réseau (et à chaque version anglaise), jour relatif ;
 * - écrit docs/marketing/lancement-50-publications.md (lecture humaine : tableau, heures proposées, textes composés).
 *
 * Heures proposées : même calcul que `scheduleCampaign` du domaine (créneau `marketing.slots` du jour de semaine, sinon
 * les autres heures de l'espace, 30 minutes d'écart au moins entre deux publications d'un même réseau le même jour).
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
const CAMPAGNE = 'lancement-2026-10';

/** Les dix espaces, dans l'ordre du document commun (S-COMMUN-reseaux.md). */
export const ESPACES = ['site_blog', 'facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'snapchat', 'telegram', 'youtube', 'whatsapp_channel'];
export const NOMS_ESPACES = {
  site_blog: 'Blogue neomoov.net', facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X', tiktok: 'TikTok',
  snapchat: 'Snapchat', telegram: 'Telegram', youtube: 'YouTube (Short)', whatsapp_channel: 'Chaîne WhatsApp',
};
/** Liens cliquables dans le texte (sinon : « lien dans la bio » ou adresse écrite en clair). */
export const LIENS_CLIQUABLES = { site_blog: true, facebook: true, instagram: false, linkedin: true, x: true, tiktok: false, snapchat: false, telegram: true, youtube: true, whatsapp_channel: true };
/** Réseaux à média : la légende passe avant le corps (le corps d'une vidéo est son script). */
export const RESEAUX_A_MEDIA = ['instagram', 'tiktok', 'snapchat', 'youtube'];

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
/** Angle (`pillar`) et public (`audience`) du format d'import, par thème. */
const PILIERS = {
  lancement: ['marque', 'tous'], aeroport: ['aeroport', 'clients'], reservation: ['service', 'clients'], electrique: ['electrique', 'clients'],
  prix: ['service', 'clients'], commodites: ['service', 'clients'], securite: ['securite', 'clients'], entreprises: ['service', 'entreprises'],
  chauffeurs: ['chauffeurs', 'chauffeurs'], academy: ['academy', 'chauffeurs'], quartiers: ['montreal', 'clients'], conseils: ['montreal', 'clients'], coulisses: ['coulisses', 'tous'],
};
export const SUJETS_PHOTO = { aeroport: 'Aéroport', vehicule: 'Véhicule électrique', chauffeur: 'Chauffeur', ville: 'Ville', client: 'Client' };
const MOTS_PHOTO = { aeroport: ['aéroport', 'Montréal-Trudeau'], vehicule: ['véhicule', 'électrique'], chauffeur: ['chauffeur'], ville: ['Montréal', 'ville'], client: ['client', 'passager'] };

/** Appels à l'action : adresses réservées (prompt S3, réglage `marketing.cta_urls`). */
export const ADRESSES = {
  reserve: 'https://neomoov.net/reserver',
  academy: 'https://neomoov.net/academy',
  preregister: 'https://neomoov.net/chauffeurs/#candidature',
};

/** Créneaux de Telegram et de la chaîne WhatsApp : absents du réglage de la branche principale, repris des défauts de S2. */
const CRENEAUX_S2 = {
  telegram: [{ day: 2, time: '17:30' }, { day: 4, time: '17:30' }],
  whatsapp_channel: [{ day: 1, time: '18:00' }, { day: 4, time: '18:00' }],
};

/** Réglage `marketing.slots` tel qu'il est écrit dans le fichier d'amorçage de la base (objet littéral évalué). */
export function lireCreneaux() {
  const source = readFileSync(join(RACINE, 'packages/db/src/seed/data.ts'), 'utf8');
  const debut = source.indexOf('key: \'marketing.slots\'');
  if (debut < 0) throw new Error('Réglage marketing.slots introuvable dans packages/db/src/seed/data.ts');
  const i = source.indexOf('{', source.indexOf('value:', debut));
  let profondeur = 0;
  let fin = i;
  for (; fin < source.length; fin += 1) {
    if (source[fin] === '{') profondeur += 1;
    if (source[fin] === '}') profondeur -= 1;
    if (profondeur === 0) break;
  }
  const creneaux = new Function(`return (${source.slice(i, fin + 1)});`)();
  return { ...CRENEAUX_S2, ...creneaux };
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

/** Décalage (minutes) de l'heure de Montréal à un instant donné. */
function decalageMinutes(instant) {
  const nom = new Intl.DateTimeFormat('en-US', { timeZone: FUSEAU, timeZoneName: 'longOffset' }).formatToParts(new Date(instant)).find((p) => p.type === 'timeZoneName').value;
  const r = /GMT([+-])(\d{2}):(\d{2})/.exec(nom);
  return r ? (r[1] === '-' ? -1 : 1) * (Number(r[2]) * 60 + Number(r[3])) : 0;
}

/** Instant (ms) d'une date et d'une heure locales de Montréal. */
function instantLocal(date, heure) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = heure.split(':').map(Number);
  const essai = Date.UTC(y, m - 1, d, hh, mm);
  return essai - decalageMinutes(essai - decalageMinutes(essai) * 60_000) * 60_000;
}

/** Date et heure locales avec leur décalage, au format ISO (heure avancée ou normale selon la date). */
function iso(instant) {
  const minutes = decalageMinutes(instant);
  const local = new Date(instant + minutes * 60_000).toISOString().slice(0, 16);
  const abs = Math.abs(minutes);
  return `${local}:00${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Heures proposées (même règle que `scheduleCampaign` du domaine, branche publication-multireseau). */
function planificateur(creneaux) {
  const pris = new Map();
  return (espace, date) => {
    const liste = [...(creneaux[espace] ?? [])].sort((a, b) => a.time.localeCompare(b.time));
    const js = jourSemaine(date);
    const heures = [...new Set([...liste.filter((c) => c.day === js).map((c) => c.time), ...liste.map((c) => c.time)])];
    const cle = `${espace}:${date}`;
    const utilises = pris.get(cle) ?? [];
    let instant = null;
    for (const h of heures) {
      const t = instantLocal(date, h);
      if (utilises.every((u) => Math.abs(u - t) >= 30 * 60_000)) {
        instant = t;
        break;
      }
    }
    if (instant === null) instant = Math.max(...utilises) + 30 * 60_000;
    utilises.push(instant);
    pris.set(cle, utilises);
    return iso(instant);
  };
}

const joindre = (...parties) => parties.filter((p) => p && String(p).trim()).map((p) => String(p).trim()).join('\n\n');

/** Texte publié tel que le réseau le reçoit (règle de `composeText` du domaine) : légende ou corps, lien, mots-clics. */
export function composer(espace, corps, legende, lien, motsClics) {
  const principal = (RESEAUX_A_MEDIA.includes(espace) && legende?.trim() ? legende : corps).trim();
  const avecLien = LIENS_CLIQUABLES[espace] && lien && !principal.includes(lien) ? lien : null;
  return joindre(principal, avecLien, motsClics?.length ? motsClics.join(' ') : null);
}

const compterMots = (texte) => texte.split(/\s+/).filter((m) => /[\p{L}\p{N}]/u.test(m)).length;

/** Une publication rédigée (forme courte des lots) devient une publication du format d'import et un modèle de lecture. */
function construire(p, planifier) {
  const date = decalerDate(DEBUT, p.jour);
  // cta « none » : l'adresse (espace membre gratuit de l'Academy) est écrite dans le texte.
  const lien = p.cta === 'none' ? null : ADRESSES[p.cta];
  const espaces = p.blog ? ESPACES : ESPACES.filter((e) => e !== 'site_blog');
  const variantes = {};
  if (p.blog) variantes.site_blog = { title: p.blog.titre, body: p.blog.corps.trim(), hashtags: [], imageText: p.img.site_blog };
  variantes.facebook = { hashtags: p.fb[1] ?? [], imageText: p.img.facebook };
  variantes.instagram = { body: p.ig[0].trim(), hashtags: p.ig[1], imageText: p.img.instagram };
  variantes.linkedin = { body: p.li[0].trim(), hashtags: p.li[2] ?? [], imageText: p.img.linkedin, en: { title: p.imgEn.linkedin, body: p.li[1].trim() } };
  variantes.x = { body: p.x[0].trim(), hashtags: p.x[2] ?? [], imageText: p.img.x, en: { title: p.imgEn.x, body: p.x[1].trim(), hashtags: p.x[3] ?? p.x[2] ?? [] } };
  variantes.tiktok = { body: p.tt[0].join('\n'), caption: p.tt[1].trim(), hashtags: p.tt[2], imageText: p.img.tiktok };
  variantes.snapchat = { format: 'short', body: p.sc[0].join('\n'), caption: p.sc[1].trim(), hashtags: p.sc[2], imageText: p.img.snapchat };
  variantes.telegram = { body: p.tg.trim(), hashtags: [], imageText: p.img.telegram };
  variantes.youtube = { title: p.yt[0], body: p.yt[1].join('\n'), caption: p.yt[2].trim(), hashtags: p.yt[3], imageText: p.img.youtube };
  variantes.whatsapp_channel = { body: p.wa.trim(), hashtags: [], imageText: p.img.whatsapp_channel };

  const courte = [p.x[0], p.tg, p.sc[1]].map((t) => t.trim()).find((t) => t.length >= 20 && t.length <= 200);
  if (!courte) throw new Error(`P${p.n} : aucune version courte de 200 caractères au plus`);
  const [pilier, public_] = PILIERS[p.theme];
  const jourLong = dateLongue(date);
  const notes = joindre(
    `Thème : ${THEMES[p.theme]}. Date proposée : ${jourLong}.`,
    `Photo réelle (${SUJETS_PHOTO[p.photo[0]].toLowerCase()}) : ${p.photo[1]}`,
    p.sensible ? `Approbation humaine : ${p.sensible}` : null,
    p.blog ? `Extrait de l'article (méta-description) : ${p.blog.extrait}` : null,
  );

  const importe = {
    ref: `P${String(p.n).padStart(2, '0')}`,
    pillar: pilier,
    audience: public_,
    title: p.blog ? p.blog.titre : p.sujet,
    body: p.fb[0].trim(),
    short: courte,
    cta: p.cta,
    hashtags: [],
    language: 'fr',
    spaces: p.blog ? 'all' : espaces,
    variants: variantes,
    photoHints: [...new Set([...MOTS_PHOTO[p.photo[0]], ...(p.photo[2] ?? [])])].slice(0, 6),
    day: p.jour + 1,
    sensitive: Boolean(p.sensible),
    notes,
  };

  // Modèle de lecture : texte composé et heure proposée par réseau (et par langue sur LinkedIn et X).
  const lecture = { ...importe, date, jourLong, theme: p.theme, photo: p.photo, motif: p.sensible ?? null, extrait: p.blog?.extrait ?? null, lien, contenus: [] };
  for (const e of espaces) {
    const v = variantes[e];
    const corps = v.body ?? importe.body;
    const heure = planifier(e, date);
    lecture.contenus.push({ espace: e, langue: 'fr', heure, titre: v.title ?? null, titreImage: v.imageText, sequences: ['tiktok', 'snapchat', 'youtube'].includes(e) ? corps.split('\n') : null, texte: composer(e, corps, v.caption, lien, v.hashtags), mots: e === 'site_blog' ? compterMots(corps) : null });
    if (v.en) lecture.contenus.push({ espace: e, langue: 'en', heure, titre: null, titreImage: v.en.title, sequences: null, texte: composer(e, v.en.body, null, lien, v.en.hashtags ?? v.hashtags), mots: null });
  }
  return { importe, lecture };
}

async function chargerLots() {
  const dossier = join(RACINE, 'scripts/publications-lancement');
  const fichiers = readdirSync(dossier).filter((f) => /^lot-\d+\.mjs$/.test(f)).sort();
  const lots = [];
  for (const f of fichiers) lots.push(...(await import(pathToFileURL(join(dossier, f)).href)).default);
  return lots.sort((a, b) => a.jour - b.jour || a.n - b.n);
}

const JOURS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function dateLongue(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${JOURS[jourSemaine(date)]} ${d === 1 ? '1er' : d} ${MOIS[m - 1]} ${y}`;
}
const heureLisible = (valeur) => valeur.slice(11, 16).replace(':', ' h ');
const citer = (texte) => texte.split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n');

function markdown(lectures, creneaux) {
  const fin = decalerDate(DEBUT, 27);
  const articles = lectures.filter((p) => p.spaces === 'all').length;
  const l = [];
  l.push('# Lancement de Neomoov : les 50 premières publications (10 espaces)');
  l.push('');
  l.push(`Document généré par \`node scripts/construire-publications.mjs\` à partir des lots \`scripts/publications-lancement/lot-*.mjs\`, vérifié par \`node scripts/verifier-publications.mjs\`. Fichier à importer dans My Hub (Marketing, Publier, « Importer des publications ») : \`docs/marketing/lancement-50-publications.json\`, au format \`docs/marketing/lancement-50-publications.schema.json\` (campagne \`${CAMPAGNE}\`). Rédaction du 3 octobre 2026, à valider par le fondateur avant toute programmation.`);
  l.push('');
  l.push(`Période proposée : du ${dateLongue(DEBUT)} au ${dateLongue(fin)} (4 semaines, heure de Montréal), 1 à 3 publications par jour ; changer \`startDate\` dans le fichier décale tout le calendrier (les textes ne citent aucun jour de semaine). Chaque publication a un texte propre à chaque réseau, un titre d'image différent par réseau (et pour chaque version anglaise) et une indication de photo réelle (règle D46, \`photoHints\` et \`notes\`). Le blogue ne reçoit que ${articles} articles (un ou deux par semaine, comme le prévoient les lignes éditoriales) ; les autres publications visent les neuf autres espaces.`);
  l.push('');
  l.push('Règles appliquées : lignes éditoriales v1.1 (vouvoiement, français du Québec d\'abord, anglais seulement sur LinkedIn et X après le français, aucun tiret long, emoji seulement sur Instagram, TikTok et Snapchat, au plus un sur Telegram et la chaîne WhatsApp) ; seuls prix : 48,20 $ (forfait aéroport Neo Premium depuis le centre-ville) et 113,83 $ (Neomoov Chauffeur Pro) ; aucune promesse de revenu, aucun concurrent, aucune donnée personnelle, rien sur la commission ; numéros publics +1 438 900 4990 et +1 438 805-7974 seulement.');
  l.push('');
  l.push('## Calendrier');
  l.push('');
  l.push('| N° | Date proposée | Thème | Sujet | Réseaux | Photo réelle | Approbation |');
  l.push('|---|---|---|---|---|---|---|');
  for (const p of lectures) {
    l.push(`| ${p.ref} | ${p.jourLong} | ${THEMES[p.theme]} | ${p.title} | ${p.spaces === 'all' ? 'les 10 (blogue compris)' : '9 (sans le blogue)'} | ${SUJETS_PHOTO[p.photo[0]]} | ${p.sensitive ? 'humaine requise' : 'standard'} |`);
  }
  l.push('');
  l.push('## Créneaux (heure de Montréal)');
  l.push('');
  l.push('Réglage `marketing.slots` (packages/db/src/seed/data.ts ; Telegram et chaîne WhatsApp : défauts de la branche publication-multireseau). L\'import place chaque réseau à l\'heure de son créneau du jour de semaine, sinon à l\'une de ses autres heures, avec 30 minutes d\'écart au moins entre deux publications d\'un même réseau le même jour. Les heures ci-dessous suivent ce calcul.');
  l.push('');
  l.push('| Espace | Créneaux |');
  l.push('|---|---|');
  for (const e of ESPACES) l.push(`| ${NOMS_ESPACES[e]} | ${(creneaux[e] ?? []).map((c) => `${JOURS[c.day]} ${c.time.replace(':', ' h ')}`).join(', ')} |`);
  l.push('');
  l.push('## Publications');
  for (const p of lectures) {
    l.push('');
    l.push(`### ${p.ref} · ${p.jourLong} · ${THEMES[p.theme]} · ${p.title}`);
    l.push('');
    l.push(`- Photo réelle (${SUJETS_PHOTO[p.photo[0]].toLowerCase()}) : ${p.photo[1]}`);
    l.push(`- Appel à l'action : ${p.lien ?? 'adresse écrite dans le texte (espace membre gratuit de l\'Academy)'}`);
    if (p.sensitive) l.push(`- Approbation humaine requise : ${p.motif}`);
    for (const c of p.contenus) {
      l.push('');
      l.push(`#### ${NOMS_ESPACES[c.espace]}${c.langue === 'en' ? ' (version anglaise)' : ''} · ${heureLisible(c.heure)} · titre d'image : « ${c.titreImage} »`);
      l.push('');
      if (c.espace === 'site_blog') {
        l.push(`**${c.titre}** (${c.mots} mots)`);
        l.push('');
        l.push(`Extrait : ${p.extrait}`);
        l.push('');
      }
      if (c.sequences) {
        if (c.titre) l.push(`Titre : ${c.titre}`);
        l.push('');
        l.push('Séquences de la vidéo (une diapositive et une phrase de narration chacune) :');
        l.push('');
        c.sequences.forEach((q, i) => l.push(`${i + 1}. ${q}`));
        l.push('');
        l.push(c.espace === 'youtube' ? 'Description :' : 'Légende :');
        l.push('');
      }
      l.push(citer(c.texte));
    }
  }
  l.push('');
  return l.join('\n');
}

async function principal() {
  const creneaux = lireCreneaux();
  const planifier = planificateur(creneaux);
  const lots = await chargerLots();
  const construites = lots.map((p) => construire(p, planifier));
  const doc = {
    $schema: './lancement-50-publications.schema.json',
    version: 1,
    campaign: CAMPAGNE,
    title: 'Lancement de Neomoov : les 50 premières publications',
    startDate: DEBUT,
    defaults: { cta: 'reserve', hashtags: [], language: 'fr' },
    publications: construites.map((c) => c.importe),
  };
  writeFileSync(join(RACINE, 'docs/marketing/lancement-50-publications.json'), `${JSON.stringify(doc, null, 2)}\n`);
  writeFileSync(join(RACINE, 'docs/marketing/lancement-50-publications.md'), markdown(construites.map((c) => c.lecture), creneaux));
  console.log(`${doc.publications.length} publications écrites (campagne ${CAMPAGNE}, à partir du ${DEBUT}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await principal();
