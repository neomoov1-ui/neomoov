#!/usr/bin/env node
/**
 * Vérifie docs/marketing/lancement-50-publications.json (agent S3, 3 octobre 2026) : règles mesurables des lignes
 * éditoriales et du prompt (longueurs par réseau, mots-clics, prix autorisés, numéros autorisés, adresses réservées,
 * aucun tiret long, nombre d'emoji, aucune commission ni promesse de revenu, aucun concurrent, vouvoiement, anglais
 * seulement sur LinkedIn et X, titres d'image uniques par publication, calendrier), puis les règles du domaine
 * (`checkContent` de packages/domain/src/marketing/rules.ts, chargé sans compilation) quand Node le permet.
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
const THEMES = ['lancement', 'aeroport', 'reservation', 'electrique', 'prix', 'commodites', 'securite', 'entreprises', 'chauffeurs', 'academy', 'quartiers', 'conseils', 'coulisses'];
const SUJETS_PHOTO = ['aeroport', 'vehicule', 'chauffeur', 'ville', 'client'];
const PRIX_AUTORISES = ['48,20 $', '113,83 $'];
const NUMEROS = ['+1 438 900 4990', '+1 438 805-7974'];
const ADRESSES = ['neomoov.net/reserver', 'neomoov.net/academy', 'neomoov.net/chauffeurs/#candidature', 'neomoov.net/academy/inscription/'];

/** Limites par espace : longueur du texte composé, mots-clics (min, max), emoji (max), séquences vidéo. */
const LIMITES = {
  site_blog: { longueur: 12_000, motsClics: [0, 0], emoji: 0 },
  facebook: { longueur: 2_000, motsClics: [0, 5], emoji: 0 },
  instagram: { longueur: 2_200, motsClics: [5, 10], emoji: 2 },
  linkedin: { longueur: 3_000, motsClics: [0, 5], emoji: 0 },
  x: { longueur: 280, motsClics: [0, 3], emoji: 0 },
  tiktok: { longueur: 2_200, motsClics: [1, 8], emoji: 2, sequences: [3, 5] },
  snapchat: { longueur: 250, motsClics: [0, 3], emoji: 2, sequences: [3, 5] },
  telegram: { longueur: 1_024, motsClics: [0, 0], emoji: 1, court: 600 },
  youtube: { longueur: 5_000, motsClics: [1, 10], emoji: 0, sequences: [3, 5], titre: 100 },
  whatsapp_channel: { longueur: 1_024, motsClics: [0, 0], emoji: 1, court: 600 },
};

const erreurs = [];
const avertissements = [];
const err = (ou, message) => erreurs.push(`${ou} : ${message}`);
const avert = (ou, message) => avertissements.push(`${ou} : ${message}`);

// Motifs mesurables. Les classes Unicode évitent les faux positifs de \b sur les lettres accentuées (« êtes », « côte »).
const L = '[\\p{L}\\p{N}]';
const mot = (alternatives, drapeaux = 'giu') => new RegExp(`(?<!${L})(?:${alternatives})(?!${L})`, drapeaux);
const TIRETS_LONGS = /[–—―‒]/;
const EMOJI = /\p{Extended_Pictographic}/gu;
const PRIX = /(?:\$\s?\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s?\$|\d+(?:[.,]\d{1,2})?\s?(?:dollars?|CAD|\$\s?CA))/giu;
const TELEPHONE = /\+?\d[\d\s().-]{6,}\d/g;
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

function normaliserPrix(brut) {
  const parties = brut.replace(/[^\d.,]/g, '').replace('.', ',').split(',');
  return `${Number(parties[0])}${parties[1] ? `,${parties[1].padEnd(2, '0').slice(0, 2)}` : ''} $`;
}
const chiffres = (s) => s.replace(/\D/g, '');
const NUMEROS_CHIFFRES = new Set(NUMEROS.map(chiffres));
const normaliserAdresse = (u) => u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[.,;:!?]+$/, '');

/** Champs de texte public d'un espace, avec leur langue. */
function textes(espace, s) {
  const t = [];
  const ajouter = (champ, valeur, langue = 'fr') => valeur && t.push({ champ, valeur: String(valeur), langue });
  ajouter('titreImage', s.titreImage);
  ajouter('titre', s.titre);
  ajouter('extrait', s.extrait);
  // LinkedIn : une seule publication, le français puis l'anglais ; chaque partie est contrôlée à part.
  ajouter('texteComplet', s.texteComplet, espace === 'linkedin' ? 'fr+en' : 'fr');
  if (espace === 'linkedin') ajouter('corpsEn', s.corpsEn, 'en');
  if (espace === 'x') ajouter('texteCompletEn', s.texteCompletEn, 'en');
  (s.sequences ?? []).forEach((q, i) => ajouter(`sequences[${i}]`, q));
  return t;
}

/** Contrôles communs à tout texte public. */
function controlerTexte(ou, valeur, langue, espace) {
  if (TIRETS_LONGS.test(valeur)) err(ou, 'tiret long ou demi-cadratin');
  for (const m of valeur.match(PRIX) ?? []) if (!PRIX_AUTORISES.includes(normaliserPrix(m))) err(ou, `prix non autorisé « ${m.trim()} »`);
  for (const m of valeur.match(TELEPHONE) ?? []) {
    const c = chiffres(m);
    if (c.length >= 7 && !NUMEROS_CHIFFRES.has(c)) err(ou, `numéro non autorisé « ${m.trim()} »`);
    if (NUMEROS_CHIFFRES.has(c) && !NUMEROS.includes(m.trim())) avert(ou, `numéro autorisé écrit autrement « ${m.trim()} » (forme attendue : ${NUMEROS.join(' ou ')})`);
  }
  for (const m of valeur.match(URL) ?? []) {
    const a = normaliserAdresse(m);
    if (!/neomoov\.net/i.test(a)) {
      err(ou, `adresse externe « ${m} »`);
      continue;
    }
    if (a !== 'neomoov.net' && !ADRESSES.includes(a)) err(ou, `adresse non réservée « ${m} »`);
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
  void espace;
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

function controlerCalendrier(doc) {
  const parJour = new Map();
  const instants = new Map();
  const blogParSemaine = new Map();
  const debut = new Date(`${doc.debut}T12:00:00Z`);
  for (const p of doc.publications) {
    const d = new Date(`${p.date}T12:00:00Z`);
    const ecart = Math.round((d - debut) / 86_400_000);
    if (ecart < 0 || ecart > 27) err(p.code, `date ${p.date} hors des 4 semaines à partir du ${doc.debut}`);
    parJour.set(p.date, (parJour.get(p.date) ?? 0) + 1);
    for (const e of ESPACES) {
      const s = p.espaces[e];
      if (!s?.inclus) continue;
      if (!s.programmeLe?.startsWith(p.date)) err(`${p.code}/${e}`, `programmation ${s.programmeLe} hors du jour ${p.date}`);
      const cle = `${e}|${s.programmeLe}`;
      if (instants.has(cle)) err(`${p.code}/${e}`, `même instant que ${instants.get(cle)} sur le même espace`);
      instants.set(cle, p.code);
      const heure = s.programmeLe?.slice(11, 16);
      if (heure && (heure < '07:00' || heure > '22:30')) avert(`${p.code}/${e}`, `heure peu courante ${heure}`);
    }
    if (p.espaces.site_blog?.inclus) {
      const lundi = new Date(d);
      lundi.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const cle = lundi.toISOString().slice(0, 10);
      blogParSemaine.set(cle, (blogParSemaine.get(cle) ?? 0) + 1);
    }
  }
  for (const [jour, n] of parJour) if (n < 1 || n > 3) err('calendrier', `${n} publications le ${jour} (1 à 3 attendues)`);
  for (let i = 0; i < 28; i += 1) {
    const j = new Date(debut);
    j.setUTCDate(debut.getUTCDate() + i);
    const cle = j.toISOString().slice(0, 10);
    if (!parJour.has(cle)) avert('calendrier', `aucune publication le ${cle}`);
  }
  for (const [lundi, n] of blogParSemaine) if (n > 2) err('calendrier', `${n} articles de blogue la semaine du ${lundi} (un ou deux par semaine)`);
}

async function principal() {
  const doc = JSON.parse(readFileSync(FICHIER, 'utf8'));
  const domaine = await reglesDuDomaine();
  let fauxPositifsDomaine = 0;
  let controlesDomaine = 0;

  if (doc.publications?.length !== 50) err('document', `${doc.publications?.length ?? 0} publications (50 attendues)`);
  const numeros = new Set();
  let articles = 0;
  for (const p of doc.publications ?? []) {
    const ou = p.code ?? `#${p.numero}`;
    if (numeros.has(p.numero)) err(ou, 'numéro en double');
    numeros.add(p.numero);
    if (!THEMES.includes(p.theme)) err(ou, `thème inconnu ${p.theme}`);
    if (!SUJETS_PHOTO.includes(p.photo?.sujet)) err(ou, `sujet de photo inconnu ${p.photo?.sujet}`);
    if (!p.photo?.indication || p.photo.indication.length < 20) err(ou, 'indication de photo réelle absente ou trop courte');
    if (!/photo réelle/i.test(p.photo?.indication ?? '')) err(ou, 'l\'indication de photo doit demander une photo réelle');
    if (!ADRESSES.includes(normaliserAdresse(p.lien ?? ''))) err(ou, `lien d'appel à l'action non réservé ${p.lien}`);

    const titresImage = new Map();
    for (const e of ESPACES) {
      const s = p.espaces?.[e];
      const ici = `${ou}/${e}`;
      if (!s) {
        err(ici, 'espace absent');
        continue;
      }
      if (!s.inclus) {
        if (e !== 'site_blog') err(ici, 'seul le blogue peut être exclu');
        continue;
      }
      const lim = LIMITES[e];
      if (e === 'site_blog') {
        articles += 1;
        if (!s.titre) err(ici, 'titre d\'article absent');
        if (s.mots < 600 || s.mots > 900) err(ici, `${s.mots} mots (600 à 900 attendus)`);
        if (!s.extrait || s.extrait.length > 160) err(ici, `extrait absent ou de plus de 160 caractères (${s.extrait?.length ?? 0})`);
      }
      if (s.longueur !== s.texteComplet?.length) err(ici, 'longueur enregistrée différente du texte composé');
      if (s.texteComplet.length > lim.longueur) err(ici, `${s.texteComplet.length} caractères (${lim.longueur} au plus)`);
      if (lim.court && s.texteComplet.length > lim.court) avert(ici, `${s.texteComplet.length} caractères : message à raccourcir (${lim.court} conseillés)`);
      if (e === 'x' && s.texteCompletEn.length > lim.longueur) err(`${ici}/en`, `${s.texteCompletEn.length} caractères (${lim.longueur} au plus)`);
      if (['linkedin', 'x'].includes(e) && !s.corpsEn?.trim()) err(ici, 'version anglaise absente');
      if (!['linkedin', 'x'].includes(e) && s.corpsEn) err(ici, 'version anglaise hors LinkedIn et X');
      const tags = s.motsClics ?? [];
      if (tags.length < lim.motsClics[0] || tags.length > lim.motsClics[1]) err(ici, `${tags.length} mots-clics (${lim.motsClics[0]} à ${lim.motsClics[1]} attendus)`);
      for (const t of [...tags, ...(s.motsClicsEn ?? [])]) if (!/^#[\p{L}\p{N}_]{2,40}$/u.test(t)) err(ici, `mot-clic invalide « ${t} »`);
      if (new Set(tags.map((t) => t.toLowerCase())).size !== tags.length) err(ici, 'mot-clic en double');
      if (lim.sequences) {
        const n = s.sequences?.length ?? 0;
        if (n < lim.sequences[0] || n > lim.sequences[1]) err(ici, `${n} séquences vidéo (${lim.sequences[0]} à ${lim.sequences[1]} attendues)`);
        for (const q of s.sequences ?? []) if (q.length > 140) err(ici, `séquence trop longue (${q.length} caractères, 140 au plus)`);
        if (!s.legende?.trim() && e !== 'youtube') err(ici, 'légende absente');
      }
      if (lim.titre && (!s.titre || s.titre.length > lim.titre)) err(ici, `titre absent ou de plus de ${lim.titre} caractères`);

      // Emoji : comptés sur tout ce que le réseau affiche (texte, séquences, titre d'image).
      const tousTextes = textes(e, s);
      const emoji = tousTextes.reduce((n, t) => n + (t.valeur.match(EMOJI) ?? []).length, 0);
      if (emoji > lim.emoji) err(ici, `${emoji} emoji (${lim.emoji} au plus)`);
      for (const t of tousTextes) controlerTexte(`${ici}/${t.champ}`, t.valeur, t.langue, e);
      if (e === 'linkedin') controlerTexte(`${ici}/corps`, s.corps, 'fr', e);

      // Titre d'image : présent, court, différent d'un réseau à l'autre pour la même publication.
      const titre = (s.titreImage ?? '').trim();
      if (!titre) err(ici, 'titre d\'image absent');
      if (titre.length > 45) err(ici, `titre d'image de ${titre.length} caractères (45 au plus)`);
      const cle = titre.toLocaleLowerCase('fr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (titresImage.has(cle)) err(ici, `titre d'image identique à celui de ${titresImage.get(cle)}`);
      titresImage.set(cle, e);

      // Règles du domaine (espaces connus du domaine seulement : Telegram et la chaîne WhatsApp arrivent avec l'agent S2).
      if (domaine?.SPACE_RULES[e]) {
        {
          const brouillons = [];
          const options = { allowedPrices: PRIX_AUTORISES, allowedPhones: NUMEROS, ctaUrls: { reserve: p.lien, academy: p.lien, preregister: p.lien } };
          const base = { space: e, format: s.format, hashtags: tags, cta: p.ctaDomaine };
          if (e === 'site_blog') brouillons.push({ ...base, language: 'fr', title: s.titre, body: s.corps, caption: null });
          else if (e === 'linkedin') brouillons.push({ ...base, language: 'fr', title: null, body: `${s.corps}\n\n${s.corpsEn}`, caption: null });
          else if (e === 'x') {
            brouillons.push({ ...base, language: 'fr', title: null, body: s.corps, caption: null });
            brouillons.push({ ...base, language: 'en', title: null, body: s.corpsEn, caption: null, hashtags: s.motsClicsEn ?? tags });
          } else if (s.sequences) brouillons.push({ ...base, language: 'fr', title: s.titre ?? null, body: s.sequences.join('\n'), caption: s.legende ?? s.description });
          else brouillons.push({ ...base, language: 'fr', title: null, body: s.corps ?? s.legende, caption: s.legende ?? null });
          for (const b of brouillons) {
            controlesDomaine += 1;
            for (const issue of domaine.checkContent(b, options)) {
              if (issue.kind === 'informal_address') {
                // Le motif du domaine (\b sans drapeau u) voit « tes » dans « êtes » et « te » dans « côte » : contre-vérifié ici.
                const texte = [b.title ?? '', b.body, b.caption ?? ''].join('\n');
                if (!TUTOIEMENT.test(texte)) {
                  fauxPositifsDomaine += 1;
                  continue;
                }
              }
              if (issue.kind === 'sensitive_topic' && p.approbationHumaine) continue;
              if (issue.kind === 'missing_cta_link') continue;
              (issue.blocking ? err : avert)(`${ici}/domaine${b.language === 'en' ? '/en' : ''}`, `${issue.kind} : ${issue.detail}`);
            }
          }
        }
      }
    }
  }
  if (articles > 10) err('document', `${articles} articles de blogue (10 au plus)`);
  controlerCalendrier(doc);

  // Le document de lecture humaine suit les mêmes règles de forme (aucun tiret long).
  try {
    const md = readFileSync(FICHIER_MD, 'utf8');
    if (TIRETS_LONGS.test(md)) err('document .md', 'tiret long dans le document de lecture');
  } catch {
    avert('document .md', 'introuvable');
  }

  console.log(`Publications : ${doc.publications?.length ?? 0} ; articles de blogue : ${articles} ; textes contrôlés par le domaine : ${controlesDomaine}${domaine ? '' : ' (règles du domaine non chargées)'}.`);
  if (fauxPositifsDomaine) console.log(`Faux positifs du domaine écartés (tutoiement vu dans « êtes », « côte »… par \\b sans Unicode) : ${fauxPositifsDomaine}.`);
  for (const a of avertissements) console.log(`Avertissement ${a}`);
  for (const e of erreurs) console.log(`Erreur ${e}`);
  console.log(`${erreurs.length} erreur(s), ${avertissements.length} avertissement(s).`);
  process.exitCode = erreurs.length ? 1 : 0;
}

await principal();
