// Lot 3, écrans mobiles restants : 3 écrans client et 6 écrans chauffeur. Lancer : node outils/lot3-mobile.js
const { C, icon, starFull, page, tabbar, h1, h2, p, grow, pill, btn, topbar, row, toggle, kv, card, chip, avatar, bar, sheet, mapBlock, bottom, register } = require('./lib');
const PAD = '60px 20px 24px 20px';
const clients = [], drivers = [];
const addC = (n, file, title, opts) => { page(Object.assign({ file, title: 'Client, ' + title }, opts)); clients.push({ file, title: n + '. ' + title.charAt(0).toUpperCase() + title.slice(1) }); };
const addD = (n, file, title, opts) => { page(Object.assign({ file, title: 'Chauffeur, ' + title }, opts)); drivers.push({ file, title: n + '. ' + title.charAt(0).toUpperCase() + title.slice(1) }); };
// Écran avec barre d'onglets : le contenu est dans un bloc rembourré, la barre reste pleine largeur.
const withTabs = (kind, active, gap, items) => ({ pad: '0', gap: 0, inner: [`<div style="flex-grow: 1; min-height: 0; padding: 60px 20px 0 20px; display: flex; flex-direction: column; gap: ${gap}px;">`, ...items, '<div style="height: 12px;"></div></div>', tabbar(kind, active)].join('\n') });
const field = (label, value, { active = false, ic = 'pin', col = C.blue } = {}) => `<div style="display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 14px; border-radius: 14px; border: ${active ? '2px solid ' + C.blue : '1px solid ' + C.line}; background: ${active ? '#FFFFFF' : C.bg};">${icon(ic, 20, col)}<div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column;"><span style="font-size: 11px; font-weight: 700; color: ${C.grey}; text-transform: uppercase; letter-spacing: 0.4px;">${label}</span><span style="font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${value}</span></div></div>`;

// Client 16. Recherche de destination
addC(16, 'Client-16-RechercheDestination.dc.html', 'recherche de destination', { pad: '60px 20px 0 20px', gap: 14, inner: [
  topbar('Où allez-vous ?'),
  `<div style="display: flex; flex-direction: column; gap: 8px;">${field('Départ', '1250, rue Sherbrooke Ouest', { ic: 'nav', col: C.green })}${field('Destination', 'Gare cen|', { active: true })}</div>`,
  `<div style="display: flex; gap: 8px; overflow: hidden;">${chip('Maison')}${chip('Travail')}${chip('Ajouter un lieu')}</div>`,
  `<div style="display: flex; flex-direction: column;">${[
    ['Gare Centrale', '895, rue De La Gauchetière O., Montréal', 'Résultat'],
    ['Gare Centrale, entrée Belmont', 'rue Belmont, Montréal', 'Résultat'],
    ['Centre Bell', '1909, av. des Canadiens-de-Montréal', 'Récent · vendredi'],
    ['Aéroport YUL, départs', '975, boul. Roméo-Vachon N., Dorval', 'Récent · forfait 55 $'],
    ['Clinique Sainte-Anne', '4675, boul. Sainte-Anne', 'Récent · lundi']].map(([t, s, tag]) => row({ ic: tag === 'Résultat' ? 'pin' : 'clock', title: t, sub: s, chev: false, right: `<span style="font-size: 12px; color: ${C.grey}; white-space: nowrap;">${tag}</span>` })).join('')}</div>`,
  grow(),
  `<div style="height: 250px; flex-shrink: 0; margin: 0 -20px; background: ${C.soft}; display: grid; grid-template-columns: repeat(10, 1fr); gap: 5px; padding: 8px 6px 20px 6px; box-sizing: border-box;">${'AZERTYUIOPQSDFGHJKLMWXCVBN'.split('').map(k => `<span style="height: 40px; border-radius: 6px; background: #FFFFFF; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600;">${k}</span>`).join('')}<span style="grid-column: span 4; height: 40px; border-radius: 6px; background: #FFFFFF;"></span></div>`
].join('\n') });

// Client 17. État vide : aucune réservation
const empty = (ic, t, s) => `<div style="flex-grow: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; padding: 0 12px;"><div style="width: 96px; height: 96px; border-radius: 48px; background: ${C.tint}; display: flex; align-items: center; justify-content: center;">${icon(ic, 44, C.blue, 1.8)}</div>${h2(t, 20)}${p(s, 15)}</div>`;
addC(17, 'Client-17-EtatVide.dc.html', 'état vide, aucune réservation', withTabs('client', 1, 12, [
  h1('Réservations', 28),
  `<div style="display: flex; gap: 8px;">${chip('À venir', true)}${chip('Passées')}</div>`,
  empty('cal', 'Aucune course planifiée', 'Réservez jusqu\'à 30 jours à l\'avance. Le prix est fixé au moment de la réservation et ne bouge plus.'),
  btn('Planifier une course', 'primary', { ic: icon('cal', 20, '#FFFFFF') })
]));

// Client 18. Erreur : aucun chauffeur disponible
addC(18, 'Client-18-AucunChauffeur.dc.html', 'aucun chauffeur disponible', { pad: '0', gap: 0, inner: [
  mapBlock(300, { route: 'M60 250 L60 150 L180 150 L180 70 L330 70', from: [60, 250], to: [330, 70] }, `<div style="position: absolute; top: 56px; left: 20px; right: 20px; height: 52px; border-radius: 14px; background: #FFFFFF; box-shadow: 0 4px 14px rgba(10,27,51,0.14); display: flex; align-items: center; gap: 10px; padding: 0 14px; box-sizing: border-box;">${icon('pin', 20, C.blue)}<span style="font-size: 15px; font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">Vers Gare Centrale · Neo Premium · 31,56 $</span></div>`),
  sheet([
    `<div style="display: flex; align-items: center; gap: 12px;"><div style="width: 48px; height: 48px; border-radius: 24px; background: ${C.waitBg}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${icon('alert', 24, C.wait)}</div><div style="display: flex; flex-direction: column; gap: 2px;">${h2('Aucun chauffeur disponible pour le moment', 17)}${p('Nous avons sollicité 9 chauffeurs autour de vous pendant 3 minutes.', 14)}</div></div>`,
    card([kv('Votre prix reste', '31,56 $', { bold: true }), p('Il ne bougera pas si vous réessayez ou planifiez.', 13)].join(''), { bg: C.tint, border: '0', gap: 4 }),
    p('Que souhaitez-vous faire ?', 15, C.ink),
    btn('Réessayer maintenant', 'primary', { ic: icon('bolt', 20, '#FFFFFF') }),
    btn('Planifier pour plus tard', 'secondary', { ic: icon('cal', 20, C.blue) }),
    btn('Joindre un opérateur', 'neutral', { ic: icon('phone', 20, C.ink) }),
    grow(), p('Un opérateur voit déjà votre demande dans My Hub et peut attribuer un chauffeur manuellement.', 13),
    `<div style="height: 14px;"></div>`
  ].join('\n'))
].join('\n') });

// Chauffeur 21. Compte de versement
const bankRow = (ic, t, s, right) => `<div style="display: flex; align-items: center; gap: 14px; min-height: 60px; border-bottom: 1px solid ${C.soft};"><div style="width: 40px; height: 40px; border-radius: 20px; background: ${C.tint}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${icon(ic, 20, C.blue)}</div><div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 16px; font-weight: 600;">${t}</span><span style="font-size: 13px; color: ${C.grey};">${s}</span></div>${right}</div>`;
addD(21, 'Chauffeur-21-CompteVersement.dc.html', 'compte de versement', withTabs('driver', 2, 16, [
  topbar('Compte de versement'),
  card([`<div style="display: flex; justify-content: space-between; align-items: center;">${h2('Prochain versement', 15)}${pill('Vendredi 25 sept.', 'ok')}</div>`,
    `<div style="font-size: 36px; font-weight: 800; letter-spacing: -0.8px;">487,62 $</div>`, p('Semaine du 14 au 20 septembre · relevé émis le vendredi, argent sur votre compte sous 1 à 2 jours ouvrables.', 13)].join(''), { pad: 18, gap: 6 }),
  h2('Où l\'argent est versé', 16),
  `<div style="display: flex; flex-direction: column;">${bankRow('card', 'Banque Nationale · ****4471', 'Compte chèques · vérifié par Stripe', pill('Actif', 'ok'))}${bankRow('shield', 'Identité vérifiée', 'Stripe Connect · 22 septembre 2026', icon('check', 20, C.ok, 2.6))}${bankRow('doc', 'Numéros TPS et TVQ', '123456789 RT0001 · 1234567890 TQ0001', icon('chev', 18, C.grey))}</div>`,
  h2('Si le net est négatif', 16),
  card([p('Quand vos débits (packs, frais perçus en direct) dépassent vos crédits, la différence est prélevée sur cette carte le vendredi.', 13), kv('Carte de prélèvement', 'Visa ****2210'), kv('Solde actuel', '0,00 $', { bold: true, col: C.ok })].join(''), { gap: 8 }),
  grow(), btn('Modifier mon compte bancaire', 'secondary', { h: 52 })
]));

// Chauffeur 22. Modes de paiement acceptés
const payRow = (t, s, on, note = '') => `<div style="display: flex; align-items: center; gap: 14px; min-height: 72px; border-bottom: 1px solid ${C.soft};"><div style="flex-grow: 1; display: flex; flex-direction: column; gap: 3px;"><span style="font-size: 16px; font-weight: 600;">${t}</span><span style="font-size: 13px; color: ${C.grey};">${s}</span>${note ? `<span style="font-size: 12px; color: ${C.wait}; font-weight: 600;">${note}</span>` : ''}</div>${toggle(on)}</div>`;
addD(22, 'Chauffeur-22-ModesPaiement.dc.html', 'modes de paiement acceptés', withTabs('driver', 4, 14, [
  topbar('Modes de paiement'),
  p('Le client choisit parmi ce que vous acceptez. La carte dans l\'application est toujours offerte.', 15),
  `<div style="display: flex; flex-direction: column;">${payRow('Carte dans l\'application', 'Neomoov encaisse et vous verse le vendredi', true, 'Toujours activé')}${payRow('Espèces', 'Vous confirmez le montant reçu à la fin de la course', true)}${payRow('Virement Interac', 'Le client envoie à votre courriel ou numéro enregistré', true)}${payRow('Terminal de paiement', 'Votre propre terminal (Square, Moneris, etc.)', false)}</div>`,
  card([h2('Paiement direct : ce qui change', 15), p('Vous gardez l\'argent tout de suite. Les frais de service (2,00 $), la redevance (0,90 $) et leurs taxes sont inscrits en débit sur votre relevé du vendredi. Le client reçoit la même facture certifiée.', 13)].join(''), { bg: C.tint, border: '0', gap: 6 }),
  kv('Courriel Interac', 'samuel.t@exemple.ca'), kv('Réponse automatique', 'Activée', { col: C.ok }),
  grow(), btn('Enregistrer', 'primary', { h: 52 })
]));

// Chauffeur 23. Arrêt en cours de route
addD(23, 'Chauffeur-23-ArretEnRoute.dc.html', 'arrêt en cours de route', { pad: '0', gap: 0, inner: [
  mapBlock(330, { route: 'M50 300 L50 200 L170 200 L170 110 L300 110 L300 40', from: [50, 300], to: [300, 40], car: [170, 150], dark: true }, `<div style="position: absolute; top: 56px; left: 16px; right: 16px; display: flex; gap: 8px;"><div style="flex-grow: 1; height: 48px; border-radius: 12px; background: ${C.dSurf}; color: #FFFFFF; display: flex; align-items: center; gap: 10px; padding: 0 12px; box-sizing: border-box; font-size: 14px; font-weight: 600;">${icon('nav', 18, '#FFFFFF')}Dans 400 m, à droite sur rue Peel</div><div style="width: 48px; height: 48px; border-radius: 12px; background: ${C.dSurf}; display: flex; align-items: center; justify-content: center;">${icon('alert', 20, '#FFFFFF')}</div></div>`),
  sheet([
    `<div style="display: flex; justify-content: space-between; align-items: center;">${h2('Arrêt ajouté par la cliente', 18)}${pill('Client à bord', 'ok')}</div>`,
    `<div style="display: flex; flex-direction: column; gap: 10px;">${[['1', 'Pharmacie Jean Coutu, rue Peel', 'Arrêt · 3 min d\'attente incluses', C.blue], ['2', 'Gare Centrale', 'Destination finale', C.red]].map(([n, t, s, col]) => `<div style="display: flex; gap: 12px; align-items: center;"><span style="width: 28px; height: 28px; border-radius: 14px; background: ${col}; color: #FFFFFF; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${n}</span><div style="display: flex; flex-direction: column;"><span style="font-size: 15px; font-weight: 600;">${t}</span><span style="font-size: 13px; color: ${C.grey};">${s}</span></div></div>`).join('')}</div>`,
    card([kv('Prix initial', '31,56 $'), kv('Arrêt et détour (+1,2 km, +4 min)', '+ 4,08 $'), kv('Nouveau prix total', '35,64 $', { bold: true }), p('Dans la limite du prix maximal consenti par la cliente (51,56 $). Elle a validé le nouveau prix.', 12)].join(''), { bg: C.bg, border: '0', gap: 6 }),
    `<div style="display: flex; gap: 10px;">${btn('Arrivé à l\'arrêt', 'green', { flex: 'flex: 1 1 0;', h: 52 })}${btn('Appeler', 'neutral', { h: 52, ic: icon('phone', 20, C.ink) })}</div>`,
    p('Attente au-delà de 3 minutes : 0,50 $ par minute, ajoutée automatiquement.', 12), `<div style="height: 6px;"></div>`
  ].join('\n'), { gap: 12 })
].join('\n') });

// Chauffeur 24. Clients fidèles
const fav = (ini, name, s, rides, last) => `<div style="display: flex; align-items: center; gap: 12px; min-height: 68px; border-bottom: 1px solid ${C.soft};">${avatar(ini, 44)}<div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 16px; font-weight: 600;">${name}</span><span style="font-size: 13px; color: ${C.grey};">${s}</span></div><div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;"><span style="font-size: 15px; font-weight: 700;">${rides}</span><span style="font-size: 12px; color: ${C.grey};">${last}</span></div></div>`;
addD(24, 'Chauffeur-24-ClientsFideles.dc.html', 'clients fidèles', withTabs('driver', 4, 14, [
  topbar('Mes clients fidèles'),
  card([`<div style="display: flex; align-items: center; gap: 12px;">${icon('heart', 26, C.blue, 2, C.tint)}<div style="display: flex; flex-direction: column; gap: 2px;">${h2('14 clients vous ont mis en favori', 16)}${p('Ils vous demandent en priorité et paient 3,00 $ de plus, versés à vous en entier.', 13)}</div></div>`].join(''), { bg: C.tint, border: '0' }),
  `<div style="display: flex; gap: 8px;">${chip('Tous', true)}${chip('Réguliers')}${chip('Entreprises')}</div>`,
  `<div style="display: flex; flex-direction: column;">${fav('SM', 'Sophie M.', 'Westmount · le matin, vers le centre-ville', '23 courses', 'lundi')}${fav('JP', 'Jean-Philippe R.', 'Outremont · aéroport, forfait 55 $', '11 courses', 'jeudi')}${fav('CL', 'Clinique Lajeunesse', 'Compte entreprise · rendez-vous patients', '9 courses', 'mardi')}${fav('AK', 'Amina K.', 'Plateau · soirs et fins de semaine', '7 courses', 'samedi')}${fav('MT', 'Marc T.', 'Verdun · courses de nuit', '4 courses', '8 sept.')}</div>`,
  card([kv('Gagné grâce aux favoris ce mois-ci', '+ 96,00 $', { bold: true, col: C.ok }), p('32 courses demandées en favori sur 187.', 13)].join(''), { gap: 4 }),
  grow()
]));

// Chauffeur 25. Résumé de séance
addD(25, 'Chauffeur-25-ResumeSeance.dc.html', 'résumé de séance', { pad: PAD, gap: 16, inner: [
  `<div style="display: flex; justify-content: space-between; align-items: center;">${h1('Bonne journée, Samuel', 26)}${pill('Hors ligne', 'dark')}</div>`,
  p('Séance du mardi 22 septembre, de 6 h 40 à 15 h 10.', 15),
  `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">${[['212,40 $', 'Gagnés (tarifs et pourboires)'], ['8 h 30', 'En ligne'], ['11', 'Courses terminées'], ['25,00 $', 'Par heure en ligne']].map(([v, l]) => card(`<span style="font-size: 24px; font-weight: 800; letter-spacing: -0.4px;">${v}</span><span style="font-size: 12px; color: ${C.grey};">${l}</span>`, { gap: 2 })).join('')}</div>`,
  card([h2('Votre journée', 15), `<div style="display: flex; flex-direction: column; gap: 8px;">${[['Tarifs des courses', '188,40 $', 100], ['Pourboires', '24,00 $', 13], ['Dont favoris (+3 $)', '9,00 $', 5], ['Commission Neomoov', '0,00 $', 0]].map(([l, v, w]) => `<div style="display: flex; flex-direction: column; gap: 4px;">${kv(l, v, { size: 14 })}${bar(w, { h: 6 })}</div>`).join('')}</div>`].join(''), { gap: 10 }),
  card([`<div style="display: flex; justify-content: space-between; align-items: center;">${h2('Pack Élite', 15)}${pill('27 courses restantes', 'info')}</div>`, bar(73, { h: 8 }), p('11 courses consommées aujourd\'hui. Renouvellement automatique à 0.', 12)].join(''), { gap: 8 }),
  `<div style="display: flex; align-items: center; gap: 10px; font-size: 14px;">${starFull(16)}<span><b>4,96</b> · 2 nouveaux avis 5 étoiles aujourd\'hui</span></div>`,
  grow(), `<div style="display: flex; gap: 10px;">${btn('Voir mes revenus', 'secondary', { flex: 'flex: 1 1 0;', h: 52 })}${btn('Repasser en ligne', 'green', { flex: 'flex: 1 1 0;', h: 52 })}</div>`
].join('\n') });

// Chauffeur 26. Profil du chauffeur
addD(26, 'Chauffeur-26-Profil.dc.html', 'profil du chauffeur', withTabs('driver', 4, 14, [
  `<div style="display: flex; align-items: center; gap: 14px;">${avatar('ST', 72)}<div style="flex-grow: 1; display: flex; flex-direction: column; gap: 3px;">${h1('Samuel Tremblay', 24)}<div style="display: flex; align-items: center; gap: 6px; font-size: 14px;">${starFull(16)}<b>4,96</b><span style="color: ${C.grey};">· 1 214 courses · depuis août 2026</span></div><div style="display: flex; gap: 6px;">${pill('Élite', 'solid', 12)}${pill('Documents à jour', 'ok', 12)}</div></div></div>`,
  card([`<div style="display: flex; align-items: center; gap: 12px;">${icon('car', 26, C.blue)}<div style="flex-grow: 1; display: flex; flex-direction: column;"><span style="font-size: 15px; font-weight: 700;">Tesla Model 3 · 2024 · blanche</span><span style="font-size: 13px; color: ${C.grey};">N52 KTB · Neo Premium · inspection valide jusqu\'au 12 mars 2027</span></div>${icon('chev', 18, C.grey)}</div>`].join(''), { pad: 12 }),
  h2('Ce que voient les clients', 15),
  `<div style="display: flex; flex-wrap: wrap; gap: 8px;">${['Ponctuel', 'Conduite douce', 'Voiture impeccable', 'Discret', 'Bilingue'].map(t => pill(t, 'info')).join('')}</div>`,
  `<div style="display: flex; flex-direction: column;">${[
    ['user', 'Informations personnelles', 'Téléphone, courriel, adresse'],
    ['doc', 'Documents et échéances', 'Permis 4C, pocket number, assurance'],
    ['wallet', 'Compte de versement', 'Banque Nationale ****4471'],
    ['card', 'Modes de paiement acceptés', 'Carte, espèces, Interac'],
    ['shield', 'Confidentialité et mes données', 'Consentements, export, suppression'],
    ['globe', 'Langue', 'Français']].map(([ic, t, s]) => row({ ic, title: t, sub: s, h: 58 })).join('')}</div>`,
  grow(), btn('Se déconnecter', 'ghost', { h: 44, size: 15 })
]));

register('client', clients);
register('chauffeur', drivers);
console.log('Lot 3 mobile :', clients.length + drivers.length, 'écrans');
