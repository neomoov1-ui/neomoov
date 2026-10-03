#!/usr/bin/env node
/**
 * Vérifie docs/marketing/lancement-50-publications.json (agent S3, 3 octobre 2026), au format d'import de My Hub
 * (docs/marketing/lancement-50-publications.schema.json de l'agent S2) :
 * - forme du fichier (champs admis, motifs, longueurs du schéma, sans dépendance de validation) ;
 * - texte de chaque réseau recomposé comme le fera l'import (`adaptForSpace` : variante sinon base, version courte sur X
 *   et Snapchat, légende d'abord sur les réseaux à média, lien d'appel à l'action sur les réseaux à liens cliquables,
 *   mots-clics) ;
 * - règles mesurables des lignes éditoriales et du prompt : longueurs par réseau, mots-clics, prix autorisés, numéros
 *   autorisés, adresses réservées, aucun tiret long, nombre d'emoji, aucune commission ni promesse de revenu, aucun
 *   concurrent, vouvoiement, anglais seulement sur LinkedIn et X, script vidéo de 3 à 5 séquences, blogue de 600 à
 *   900 mots, titres d'image tous différents dans une publication, calendrier (1 à 3 publications par jour) ;
 * - règles du domaine (`checkContent` de packages/domain/src/marketing/rules.ts, chargé sans compilation).
 *
 * Usage : node scripts/verifier-publications.mjs [chemin.json]   (code de sortie 1 s'il reste une erreur)
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FICHIER = resolve(process.argv[2] ?? join(RACINE, 'docs/marketing/lancement-50-publications.json'));
const FICHIER_MD = FICHIER.replace(/\.json$/, '.md');

const ESPACES = ['site_blog', 'facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'snapchat', 'telegram', 'youtube', 'whatsapp_channel'];
const PILIERS = ['service', 'aeroport', 'montreal', 'electrique', 'securite', 'chauffeurs', 'academy', 'marque', 'coulisses', 'faq'];
const PUBLICS = ['clients', 'chauffeurs', 'entreprises', 'tous'];
const FORMATS = ['post', 'article', 'reel', 'story', 'video', 'short'];
const PRIX_AUTORISES = ['48,20 $', '113,83 $'];
const NUMEROS = ['+1 438 900 4990', '+1 438 805-7974'];
const CTA = { reserve: 'https://neomoov.net/reserver', academy: 'https://neomoov.net/academy', preregister: 'https://neomoov.net/chauffeurs/#candidature', none: null };
const ADRESSES = ['neomoov.net/reserver', 'neomoov.net/academy', 'neomoov.net/chauffeurs/#candidature', 'neomoov.net/academy/inscription/'];
const LIENS_CLIQUABLES = ['site_blog', 'facebook', 'linkedin', 'x', 'telegram', 'youtube', 'whatsapp_channel'];
const RESEAUX_A_MEDIA = ['instagram', 'tiktok', 'snapchat', 'youtube'];
const RESEAUX_VIDEO = ['tiktok', 'snapchat', 'youtube'];
const VERSION_COURTE = ['x', 'snapchat'];
const AVEC_TITRE = ['site_blog', 'youtube'];

/** Limites par espace : texte composé (règles des réseaux, S2), mots-clics (min, max), emoji (max). */
const LIMITES = {
  site_blog: { longueur: 12_000, motsClics: [0, 0], emoji: 0 },
  facebook: { longueur: 2_000, motsClics: [0, 5], emoji: 0 },
  instagram: { longueur: 2_200, motsClics: [5, 10], emoji: 2 },
  linkedin: { longueur: 3_000, motsClics: [0, 5], emoji: 0 },
  x: { longueur: 280, motsClics: [0, 3], emoji: 0 },
  tiktok: { longueur: 2_200, motsClics: [1, 8], emoji: 2 },
  snapchat: { longueur: 250, motsClics: [0, 3], emoji: 2 },
  telegram: { longueur: 1_024, motsClics: [0, 0], emoji: 1, court: 600 },
  youtube: { longueur: 5_000, motsClics: [1, 10], emoji: 0 },
  whatsapp_channel: { longueur: 1_000, motsClics: [0, 0], emoji: 1, court: 600 },
};

const erreurs = [];
const avertissements = [];
const err = (ou, message) => erreurs.push(`${ou} : ${message}`);
const avert = (ou, message) => avertissements.push(`${ou} : ${message}`);

// Motifs mesurables. Les classes Unicode évitent les faux positifs de \b sur les lettres accentuées (« êtes », « côte »).
const L = '[\\p{L}\\p{N}]';
const mot = (alternatives, drapeaux = 'giu') => new RegExp(`(?<!${L})(?:${alternatives})(?!${L})`, drapeaux);
const TIRETS_LONGS = /[‒–—―]/;
const EMOJI = /\p{Extended_Pictographic}/gu;
const PRIX = /(?:\$\s?\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s?\$|\d+(?:[.,]\d{1,2})?\s?(?:dollars?|CAD))/giu;
const TELEPHONE = /\+?\d[\d  ().-]{6,}\d/g;
const URL = /(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)*\.(?:net|com|ca|org|me|io|ly|gl|app|co)(?:\/[^\s)»"]*)?/giu;
const INTERDITS = [
  ['commission', mot('commissions?|commission-free|zéro commission|sans commission')],
  ['promesse de revenu ou d\'argent côté chauffeur', mot('gagne[rz]?|gagnant|gains?|revenus?|salaires?|rentab\\p{L}*|rémunération|mieux payée?s?|empoche\\p{L}*|earn\\p{L}*|income|salary|profits?|revenue')],
  ['concurrent nommé', mot('uber|lyft|eva|bolt|téo|teo taxi|taxelco|netlift|hypra|taxi diamond|taxi coop|coop de taxi')],
  ['levée de fonds', mot('levée de fonds|investisseurs?|investir|investissement|actionnaires?|financement participatif|crowdfunding|investors?|fundrais\\p{L}*')],
  ['image de synthèse', mot('image de synthèse|générée? par (?:l\')?ia|ai[- ]generated')],
  ['adresse courriel', /[\w.+-]+@[\w-]+\.[\w.-]+/g],
];
const TUTOIEMENT = mot('tu|te|toi|ton|ta|tes|t\'as|t\'es', 'iu');
const MOTS_ANGLAIS = mot('the|and|your|you|with|book|ride|driver|from|our|we|is|are|to|for', 'giu');
const MOT_CLIC = /^#?[\p{L}\p{N}_]{2,40}$/u;

function normaliserPrix(brut) {
  const parties = brut.replace(/[^\d.,]/g, '').replace('.', ',').split(',');
  return `${Number(parties[0])}${parties[1] ? `,${parties[1].padEnd(2, '0').slice(0, 2)}` : ''} $`;
}
const chiffres = (s) => s.replace(/\D/g, '');
const NUMEROS_CHIFFRES = new Set(NUMEROS.map(chiffres));
const normaliserAdresse = (u) => u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[.,;:!?]+$/, '');
const avecDiese = (t) => (t.startsWith('#') ? t : `#${t}`);

/** Contrôles communs à tout texte public. */
function controlerTexte(ou, valeur, langue) {
  if (!valeur) return;
  if (TIRETS_LONGS.test(valeur)) err(ou, 'tiret long ou demi-cadratin');
  for (const m of valeur.match(PRIX) ?? []) if (!PRIX_AUTORISES.includes(normaliserPrix(m))) err(ou, `prix non autorisé « ${m.trim()} »`);
  for (const m of valeur.match(TELEPHONE) ?? []) {
    const c = chiffres(m);
    if (c.length >= 7 && !NUMEROS_CHIFFRES.has(c)) err(ou, `numéro non autorisé « ${m.trim()} »`);
    if (NUMEROS_CHIFFRES.has(c) && !NUMEROS.includes(m.trim())) avert(ou, `numéro autorisé écrit autrement « ${m.trim()} » (forme attendue : ${NUMEROS.join(' ou ')})`);
  }
  for (const m of valeur.match(URL) ?? []) {
    const a = normaliserAdresse(m);
    if (!/^neomoov\.net(?:\/|$)/i.test(a)) err(ou, `adresse externe « ${m} »`);
    else if (a !== 'neomoov.net' && !ADRESSES.includes(a)) err(ou, `adresse non réservée « ${m} »`);
  }
  for (const [nom, motif] of INTERDITS) {
    motif.lastIndex = 0;
    const m = motif.exec(valeur);
    if (m) err(ou, `${nom} : « ${m[0]} »`);
  }
  if (langue === 'fr') {
    const m = TUTOIEMENT.exec(valeur);
    if (m) err(ou, `tutoiement possible : « ${m[0]} »`);
    const anglais = valeur.match(MOTS_ANGLAIS) ?? [];
    if (anglais.length >= 4) err(ou, `texte anglais hors LinkedIn et X ? (${anglais.slice(0, 5).join(', ')})`);
  }
}

/** Champs admis (le schéma interdit les propriétés supplémentaires). */
function champsAdmis(ou, objet, admis) {
  for (const cle of Object.keys(objet ?? {})) if (!admis.includes(cle)) err(ou, `champ non prévu par le schéma « ${cle} »`);
}
function longueur(ou, nom, valeur, min, max) {
  if (valeur === undefined) return;
  if (typeof valeur !== 'string') return err(ou, `${nom} doit être un texte`);
  if (valeur.length < min || valeur.length > max) err(ou, `${nom} de ${valeur.length} caractères (${min} à ${max})`);
}
function controlerMotsClics(ou, liste) {
  if (liste === undefined) return;
  if (!Array.isArray(liste) || liste.length > 10) return err(ou, 'mots-clics : liste de 10 au plus attendue');
  for (const t of liste) if (!MOT_CLIC.test(t)) err(ou, `mot-clic invalide « ${t} »`);
  if (new Set(liste.map((t) => avecDiese(t).toLowerCase())).size !== liste.length) err(ou, 'mot-clic en double');
}

/** Texte publié (règle de `composeText` du domaine). */
function composer(espace, corps, legende, lien, motsClics) {
  const principal = (RESEAUX_A_MEDIA.includes(espace) && legende?.trim() ? legende : corps).trim();
  const parties = [principal];
  if (lien && LIENS_CLIQUABLES.includes(espace) && !principal.includes(lien)) parties.push(lien);
  if (motsClics.length) parties.push(motsClics.map(avecDiese).join(' '));
  return parties.join('\n\n');
}

async function reglesDuDomaine() {
  try {
    const { registerHooks } = await import('node:module');
    if (typeof registerHooks !== 'function') return null;
    // Les sources du domaine importent « ./spaces.js » : on résout vers le fichier .ts, lu par Node sans compilation.
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
          try {
            return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
          } catch {
            /* repli sur la résolution normale */
          }
        }
        return nextResolve(specifier, context);
      },
    });
    process.removeAllListeners('warning');
    const { checkContent } = await import(pathToFileURL(join(RACINE, 'packages/domain/src/marketing/rules.ts')).href);
    const { SPACE_RULES } = await import(pathToFileURL(join(RACINE, 'packages/domain/src/marketing/spaces.ts')).href);
    return { checkContent, SPACE_RULES };
  } catch (e) {
    avert('domaine', `règles du domaine non chargées (${e.message.split('\n')[0]}) : seules les règles du script sont appliquées`);
    return null;
  }
}

function decalerDate(date, jours) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

async function principal() {
  const doc = JSON.parse(readFileSync(FICHIER, 'utf8'));
  const domaine = await reglesDuDomaine();
  let fauxPositifsDomaine = 0;
  let controlesDomaine = 0;
  let contenus = 0;

  // Forme du fichier.
  champsAdmis('document', doc, ['$schema', 'version', 'campaign', 'title', 'startDate', 'defaults', 'publications']);
  if (doc.version !== 1) err('document', 'version 1 attendue');
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(doc.campaign ?? '')) err('document', `code de campagne invalide « ${doc.campaign} »`);
  longueur('document', 'titre', doc.title, 1, 160);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.startDate ?? '')) err('document', 'startDate (AAAA-MM-JJ) attendu pour le calendrier proposé');
  champsAdmis('document/defaults', doc.defaults, ['spaces', 'cta', 'hashtags', 'language']);
  controlerMotsClics('document/defaults', doc.defaults?.hashtags);
  if (doc.publications?.length !== 50) err('document', `${doc.publications?.length ?? 0} publications (50 attendues)`);

  const refs = new Set();
  const parJour = new Map();
  const articlesParSemaine = new Map();
  let articles = 0;
  for (const p of doc.publications ?? []) {
    const ou = p.ref ?? '?';
    champsAdmis(ou, p, ['ref', 'pillar', 'audience', 'title', 'body', 'short', 'imageText', 'cta', 'hashtags', 'language', 'spaces', 'variants', 'photoHints', 'day', 'scheduledAt', 'sensitive', 'notes']);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(p.ref ?? '')) err(ou, 'ref invalide');
    if (refs.has(p.ref)) err(ou, 'ref en double');
    refs.add(p.ref);
    if (p.pillar && !PILIERS.includes(p.pillar)) err(ou, `pillar inconnu ${p.pillar}`);
    if (p.audience && !PUBLICS.includes(p.audience)) err(ou, `audience inconnue ${p.audience}`);
    longueur(ou, 'title', p.title, 3, 120);
    longueur(ou, 'body', p.body, 40, 12_000);
    longueur(ou, 'short', p.short, 20, 200);
    if (p.title === undefined || p.body === undefined || p.short === undefined) err(ou, 'title, body et short sont obligatoires');
    longueur(ou, 'imageText', p.imageText, 3, 70);
    const cta = p.cta ?? doc.defaults?.cta ?? 'none';
    if (!(cta in CTA)) err(ou, `cta inconnu ${cta}`);
    controlerMotsClics(ou, p.hashtags);
    if (!Number.isInteger(p.day) || p.day < 1 || p.day > 28) err(ou, `day ${p.day} hors des 4 semaines (1 à 28)`);
    if (p.scheduledAt) avert(ou, 'scheduledAt fixe une heure unique pour tous les réseaux');
    if (p.sensitive !== undefined && typeof p.sensitive !== 'boolean') err(ou, 'sensitive doit être vrai ou faux');
    longueur(ou, 'notes', p.notes, 0, 1_000);
    if (!/Photo réelle/.test(p.notes ?? '')) err(ou, 'notes : indication de photo réelle absente');
    if (!Array.isArray(p.photoHints) || !p.photoHints.length || p.photoHints.length > 6 || p.photoHints.some((h) => h.length < 2 || h.length > 40)) err(ou, 'photoHints : 1 à 6 mots de 2 à 40 caractères attendus');
    for (const h of p.photoHints ?? []) controlerTexte(`${ou}/photoHints`, h, 'neutre');
    controlerTexte(`${ou}/notes`, p.notes, 'fr');
    parJour.set(p.day, (parJour.get(p.day) ?? 0) + 1);

    const selection = p.spaces ?? doc.defaults?.spaces ?? 'all';
    const espaces = selection === 'all' ? ESPACES : ESPACES.filter((e) => selection.includes(e));
    if (selection !== 'all' && (selection.length !== espaces.length || new Set(selection).size !== selection.length)) err(ou, 'spaces : code inconnu ou en double');
    if (espaces.length < 9 || !ESPACES.filter((e) => e !== 'site_blog').every((e) => espaces.includes(e))) err(ou, 'les neuf réseaux (hors blogue) sont attendus pour chaque publication');
    champsAdmis(`${ou}/variants`, p.variants, ESPACES);
    const base = { title: p.title, body: p.body, short: p.short, imageText: p.imageText ?? null, hashtags: p.hashtags ?? doc.defaults?.hashtags ?? [] };
    const lien = CTA[cta] ?? null;
    const titresImage = new Map();

    for (const e of espaces) {
      const v = p.variants?.[e] ?? {};
      const ici = `${ou}/${e}`;
      const lim = LIMITES[e];
      if (!p.variants?.[e]) err(ici, 'variante absente : chaque réseau reçoit un texte et un titre d\'image propres');
      champsAdmis(ici, v, ['format', 'language', 'title', 'body', 'caption', 'hashtags', 'imageText', 'en']);
      if (v.format && !FORMATS.includes(v.format)) err(ici, `format inconnu ${v.format}`);
      longueur(ici, 'title', v.title, 1, 100);
      longueur(ici, 'body', v.body, 1, 12_000);
      longueur(ici, 'caption', v.caption, 0, 2_200);
      longueur(ici, 'imageText', v.imageText, 3, 70);
      controlerMotsClics(ici, v.hashtags);

      const corps = (v.body?.trim() || (VERSION_COURTE.includes(e) ? base.short : base.body)).trim();
      const legende = v.caption?.trim() || null;
      const titre = v.title?.trim() || (AVEC_TITRE.includes(e) ? base.title : null);
      const motsClics = v.hashtags ?? base.hashtags;
      const texte = composer(e, corps, legende, lien, motsClics);
      contenus += 1;

      if (texte.length > lim.longueur) err(ici, `${texte.length} caractères composés (${lim.longueur} au plus)`);
      if (lim.court && texte.length > lim.court) avert(ici, `${texte.length} caractères : message à raccourcir (${lim.court} conseillés)`);
      if (motsClics.length < lim.motsClics[0] || motsClics.length > lim.motsClics[1]) err(ici, `${motsClics.length} mots-clics (${lim.motsClics[0]} à ${lim.motsClics[1]} attendus)`);
      if (AVEC_TITRE.includes(e) && !titre) err(ici, 'titre absent');
      if (e === 'site_blog') {
        articles += 1;
        const mots = corps.split(/\s+/).filter((m) => /[\p{L}\p{N}]/u.test(m)).length;
        if (mots < 600 || mots > 900) err(ici, `${mots} mots (600 à 900 attendus)`);
        const lundi = decalerDate(doc.startDate, p.day - 1);
        const d = new Date(`${lundi}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
        const semaine = d.toISOString().slice(0, 10);
        articlesParSemaine.set(semaine, (articlesParSemaine.get(semaine) ?? 0) + 1);
      }
      if (RESEAUX_VIDEO.includes(e)) {
        const sequences = corps.split('\n').map((s) => s.trim()).filter(Boolean);
        if (sequences.length < 3 || sequences.length > 5) err(ici, `${sequences.length} séquences vidéo (3 à 5, une par ligne)`);
        for (const s of sequences) if (s.length < 12 || s.length > 140) err(ici, `séquence de ${s.length} caractères (12 à 140, sinon pas de diapositive) : « ${s} »`);
        if (!legende) err(ici, e === 'youtube' ? 'description absente' : 'légende absente');
        if (e === 'snapchat' && v.format !== 'short') err(ici, 'format « short » attendu pour une vidéo Snapchat (« story » donne une image)');
      }
      // Emoji : texte publié, plus le script quand la légende le remplace (réseaux à média), plus le titre d'image.
      const scriptHorsTexte = RESEAUX_A_MEDIA.includes(e) && legende ? corps : '';
      const emoji = [texte, scriptHorsTexte, v.imageText ?? ''].join('\n').match(EMOJI)?.length ?? 0;
      if (emoji > lim.emoji) err(ici, `${emoji} emoji (${lim.emoji} au plus)`);
      controlerTexte(`${ici}/texte`, texte, 'fr');
      if (RESEAUX_VIDEO.includes(e)) controlerTexte(`${ici}/script`, corps, 'fr');
      controlerTexte(`${ici}/titre`, titre, 'fr');

      // Titre d'image : présent, court, différent d'un réseau à l'autre (et de chaque version anglaise).
      const titresDuReseau = [[v.imageText ?? base.imageText ?? base.title, 'fr']];
      if (v.en) titresDuReseau.push([v.en.title ?? base.title, 'en']);
      for (const [t, langue] of titresDuReseau) {
        const ti = String(t ?? '').trim();
        if (ti.length < 3 || ti.length > 45) err(ici, `titre d'image de ${ti.length} caractères (3 à 45) : « ${ti} »`);
        controlerTexte(`${ici}/titreImage${langue === 'en' ? '/en' : ''}`, ti, langue);
        if ((ti.match(EMOJI) ?? []).length) err(ici, 'emoji dans un titre d\'image');
        const cle = ti.toLocaleLowerCase('fr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        if (titresImage.has(cle)) err(ici, `titre d'image « ${ti} » identique à celui de ${titresImage.get(cle)}`);
        titresImage.set(cle, `${e}${langue === 'en' ? ' (anglais)' : ''}`);
      }

      // Version anglaise : LinkedIn et X seulement, après la française.
      if (v.en) {
        champsAdmis(`${ici}/en`, v.en, ['title', 'body', 'hashtags']);
        if (!['linkedin', 'x'].includes(e)) err(ici, 'version anglaise hors LinkedIn et X');
        longueur(`${ici}/en`, 'body', v.en.body, 1, 3_000);
        longueur(`${ici}/en`, 'title', v.en.title, 1, 100);
        controlerMotsClics(`${ici}/en`, v.en.hashtags);
        const motsClicsEn = v.en.hashtags ?? motsClics;
        const texteEn = composer(e, v.en.body, null, lien, motsClicsEn);
        contenus += 1;
        if (texteEn.length > lim.longueur) err(`${ici}/en`, `${texteEn.length} caractères composés (${lim.longueur} au plus)`);
        if (motsClicsEn.length > lim.motsClics[1]) err(`${ici}/en`, `${motsClicsEn.length} mots-clics (${lim.motsClics[1]} au plus)`);
        if ((texteEn.match(EMOJI) ?? []).length) err(`${ici}/en`, 'emoji');
        controlerTexte(`${ici}/en`, texteEn, 'en');
      } else if (['linkedin', 'x'].includes(e)) err(ici, 'version anglaise absente (LinkedIn et X : français puis anglais)');

      // Règles du domaine (espaces connus de la branche principale ; Telegram et la chaîne WhatsApp arrivent avec S2).
      if (domaine?.SPACE_RULES[e]) {
        const options = { allowedPrices: PRIX_AUTORISES, allowedPhones: NUMEROS, ctaUrls: { reserve: CTA.reserve, academy: CTA.academy, preregister: CTA.preregister } };
        const format = v.format ?? { site_blog: 'article', tiktok: 'short', youtube: 'short', snapchat: 'story' }[e] ?? 'post';
        const brouillons = [{ space: e, format, language: 'fr', title: titre, body: corps, caption: legende, hashtags: motsClics.map(avecDiese), cta }];
        if (v.en) brouillons.push({ space: e, format, language: 'en', title: v.en.title ?? null, body: v.en.body, caption: null, hashtags: (v.en.hashtags ?? motsClics).map(avecDiese), cta });
        for (const b of brouillons) {
          controlesDomaine += 1;
          for (const issue of domaine.checkContent(b, options)) {
            if (issue.kind === 'informal_address') {
              // Le motif du domaine (\b sans drapeau u) voit « tes » dans « êtes » et « te » dans « côte » : contre-vérifié ici.
              if (!TUTOIEMENT.test([b.title ?? '', b.body, b.caption ?? ''].join('\n'))) {
                fauxPositifsDomaine += 1;
                continue;
              }
            }
            if (issue.kind === 'sensitive_topic' && p.sensitive) continue;
            (issue.blocking ? err : avert)(`${ici}/domaine${b.language === 'en' ? '/en' : ''}`, `${issue.kind} : ${issue.detail}`);
          }
        }
      }
    }
  }

  // Calendrier : 1 à 3 publications par jour sur 28 jours, un ou deux articles de blogue par semaine, 10 au plus.
  for (let jour = 1; jour <= 28; jour += 1) {
    const n = parJour.get(jour) ?? 0;
    if (n > 3) err('calendrier', `${n} publications le jour ${jour} (3 au plus)`);
    if (n === 0) avert('calendrier', `aucune publication le jour ${jour}`);
  }
  for (const [semaine, n] of articlesParSemaine) if (n > 2) err('calendrier', `${n} articles de blogue la semaine du ${semaine} (un ou deux par semaine)`);
  if (articles > 10) err('document', `${articles} articles de blogue (10 au plus)`);

  // Le document de lecture humaine suit les mêmes règles de forme (aucun tiret long).
  try {
    if (TIRETS_LONGS.test(readFileSync(FICHIER_MD, 'utf8'))) err('document .md', 'tiret long dans le document de lecture');
  } catch {
    avert('document .md', 'introuvable');
  }

  console.log(`Publications : ${doc.publications?.length ?? 0} ; textes composés contrôlés : ${contenus} ; articles de blogue : ${articles} ; brouillons passés aux règles du domaine : ${controlesDomaine}${domaine ? '' : ' (règles du domaine non chargées)'}.`);
  if (fauxPositifsDomaine) console.log(`Faux positifs du domaine écartés (tutoiement vu dans « êtes », « côte »… par \\b sans Unicode) : ${fauxPositifsDomaine}.`);
  for (const a of avertissements) console.log(`Avertissement ${a}`);
  for (const e of erreurs) console.log(`Erreur ${e}`);
  console.log(`${erreurs.length} erreur(s), ${avertissements.length} avertissement(s).`);
  process.exitCode = erreurs.length ? 1 : 0;
}

await principal();
