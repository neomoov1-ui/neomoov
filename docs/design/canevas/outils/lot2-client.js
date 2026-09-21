// Lot 2, application client : 10 écrans. Lancer : node outils/lot2-client.js
const { C, icon, starFull, page, tabbar, h1, h2, p, grow, pill, btn, topbar, row, toggle, kv, card, chip, avatar, bar, sheet, mapBlock, bottom, register } = require('./lib');
const PAD = '60px 20px 24px 20px';
const out = [];
const add = (file, title, opts) => { page(Object.assign({ file, title: 'Client, ' + title }, opts)); out.push({ file, title: (out.length + 6) + '. ' + title.charAt(0).toUpperCase() + title.slice(1) }); };

// 6. Code reçu par texto
const box = (d, on) => `<div style="flex: 1 1 0; height: 64px; border-radius: 14px; border: ${on ? '2px solid ' + C.blue : '1px solid ' + C.line}; background: ${d ? '#FFFFFF' : C.bg}; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 800;">${d}</div>`;
add('Client-06-Code.dc.html', 'code reçu par texto', { pad: PAD, gap: 22, inner: [
  topbar(''), h1('Entrez votre code'), p('Nous l\'avons envoyé par texto au 514 555 0142.', 16),
  `<div style="display: flex; gap: 8px;">${['4', '8', '1', '', '', ''].map((d, i) => box(d, i === 3)).join('')}</div>`,
  p('Vous pourrez demander un nouveau code dans 0:42.'), grow(),
  btn('Vérifier'), btn('Modifier mon numéro', 'ghost', { h: 48, size: 15 })
].join('\n') });

// 7. Consentements
const consent = (t, s, on, tag) => `<div style="display: flex; align-items: center; gap: 14px; min-height: 76px; border-bottom: 1px solid ${C.soft};"><div style="flex-grow: 1; display: flex; flex-direction: column; gap: 3px;"><span style="font-size: 16px; font-weight: 600;">${t}</span><span style="font-size: 14px; color: ${C.grey};">${s}</span></div>${tag ? pill('Nécessaire', 'info') : toggle(on)}</div>`;
add('Client-07-Consentements.dc.html', 'consentements', { pad: PAD, gap: 16, inner: [
  h1('Vos choix, en clair'), p('Rien n\'est activé d\'office, sauf ce qui est indispensable pour vous transporter.', 16),
  `<div style="display: flex; flex-direction: column;">${[
    consent('Conditions et confidentialité', 'Version du 22 septembre 2026. <a href="#lire">Lire</a>', true, true),
    consent('Ma position pendant l\'utilisation', 'Pour vous trouver et suivre la course', true, true),
    consent('Offres et nouvelles par courriel', 'Nouveautés et offres de Neomoov', false),
    consent('Offres par texto', 'Promotions ponctuelles', false),
    consent('Amélioration du service', 'Analyse de mes courses, sans mon nom', false)].join('')}</div>`,
  p('Vous pouvez changer d\'avis à tout moment dans votre profil.'), grow(), btn('Accepter et continuer')
].join('\n') });

// 8. Options de la course
const opt = (t, s, on) => `<div style="display: flex; align-items: center; gap: 14px; min-height: 62px; border-bottom: 1px solid ${C.soft};"><div style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 16px; font-weight: 600;">${t}</span><span style="font-size: 14px; color: ${C.grey};">${s}</span></div>${toggle(on)}</div>`;
add('Client-08-Options.dc.html', 'options de la course', { pad: '60px 20px 0 20px', gap: 12, inner: [
  topbar('Options de la course'),
  `<div style="display: flex; flex-direction: column;">${[
    opt('Offre Flex', 'Hors pointe. Prise en charge en 15 minutes au plus, tarif réduit de 10 %', true),
    opt('Priorité', 'Le chauffeur le plus proche, tout de suite', false),
    opt('Mon chauffeur favori', 'Samuel T., s\'il est disponible', true),
    opt('Siège d\'enfant', 'Sur demande, selon le véhicule', false),
    opt('Bagages volumineux', 'Plus de deux grandes valises', false),
    opt('Je réserve pour quelqu\'un', 'Nom et cellulaire du passager', false)].join('')}</div>`,
  h2('Préférences à bord'),
  `<div style="display: flex; flex-wrap: wrap; gap: 8px;">${chip('Trajet calme', true)}${chip('Discussion')}${chip('21 °C', true)}${chip('Musique douce')}</div>`,
  grow(),
  `<div style="margin: 0 -20px; padding: 12px 20px 24px 20px; border-top: 1px solid ${C.soft}; display: flex; flex-direction: column; gap: 10px;">${kv('Neo Premium avec Flex, tout compris', '28,74 $', { bold: true, size: 17 })}${btn('Appliquer')}</div>`
].join('\n') });

// 9. Mode de paiement
const pay = (t, s, sel) => `<button type="button" style="min-height: 64px; border: ${sel ? '2px solid ' + C.blue : '1px solid ' + C.line}; border-radius: 14px; background: ${sel ? C.sel : '#FFFFFF'}; display: flex; align-items: center; gap: 14px; padding: 0 14px; text-align: left;">${icon('card', 22, C.blue)}<div style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 16px; font-weight: 600; color: ${C.ink};">${t}</span><span style="font-size: 14px; color: ${C.grey};">${s}</span></div>${sel ? icon('check', 22, C.blue, 2.6) : ''}</button>`;
add('Client-09-Paiement.dc.html', 'mode de paiement', { pad: PAD, gap: 10, inner: [
  topbar('Mode de paiement'),
  pay('Visa •••• 4242', 'Carte enregistrée', true), pay('Apple Pay', 'Paiement dans l\'application', false), pay('Google Pay', 'Paiement dans l\'application', false),
  pay('Interac au chauffeur', 'Virement à la fin de la course', false), pay('Espèces', 'Payées au chauffeur', false), pay('Terminal du chauffeur', 'Carte présentée à bord', false),
  p('Seuls les modes acceptés par les chauffeurs de votre secteur sont affichés. Le prix et la facture sont les mêmes, quel que soit le mode.', 14),
  grow(), btn('Ajouter une carte', 'secondary', { ic: icon('plus', 20, C.blue) })
].join('\n') });

// 10. Recherche de chauffeur
add('Client-10-Recherche.dc.html', 'recherche de chauffeur', { inner: [
  mapBlock(420, { me: [210, 210], route: 'M210 210 H330 V126' , to: [330, 126] }),
  sheet([
    `<div style="display: flex; justify-content: space-between; align-items: flex-end;"><div style="display: flex; flex-direction: column; gap: 2px;">${p('Nous cherchons votre chauffeur')}<div style="font-size: 34px; font-weight: 800; letter-spacing: -0.8px;">0:08</div></div>${pill('Modèle garanti', 'solid')}</div>`,
    bar(38),
    card(kv('Neo Premium · Tesla Model 3', '31,56 $', { bold: true, size: 16 }) + p('Prix fixe, tout compris. Rien ne change pendant la recherche.', 14), { bg: C.bg }),
    grow()
  ].join('\n')),
  bottom(btn('Annuler sans frais', 'neutral', { flex: 'flex-grow: 1;' }))
].join('\n') });

// 11. En course
add('Client-11-EnCourse.dc.html', 'en course', { inner: [
  mapBlock(440, { route: 'M80 308 H210 V132 H330', from: [80, 308], to: [330, 132], car: [210, 220] },
    `<div style="position: absolute; left: 50%; top: 60px; transform: translateX(-50%); padding: 8px 16px; border-radius: 999px; background: ${C.ink}; color: #FFFFFF; font-size: 15px; font-weight: 700; white-space: nowrap;">Arrivée prévue à 9 h 24</div>`),
  sheet([
    `<div style="display: flex; justify-content: space-between; align-items: flex-end;"><div style="display: flex; flex-direction: column; gap: 2px;">${p('Vers Avenue du Parc')}<div style="font-size: 38px; font-weight: 800; letter-spacing: -1px; line-height: 1;">12 min</div></div><div style="font-size: 18px; font-weight: 800;">31,56 $</div></div>`,
    `<div style="display: flex; align-items: center; gap: 12px; border: 1px solid ${C.line}; border-radius: 16px; padding: 12px;">${avatar('ST', 48)}<div style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 16px; font-weight: 700;">Samuel T.</span><span style="font-size: 14px; color: ${C.grey};">Tesla Model 3, blanche · N52 KTB</span></div></div>`,
    grow()
  ].join('\n')),
  bottom(btn('SOS', 'danger', { h: 52 }) + btn('Partager mon trajet', 'neutral', { h: 52, flex: 'flex-grow: 1;', ic: icon('share', 20, C.blue), size: 16 }))
].join('\n') });

// 12. Réservations planifiées
const resa = (when, route, meta, st, kind) => card(`<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;"><span style="font-size: 16px; font-weight: 700;">${when}</span>${pill(st, kind)}</div><span style="font-size: 15px;">${route}</span><span style="font-size: 14px; color: ${C.grey};">${meta}</span>`);
add('Client-12-Reservations.dc.html', 'réservations planifiées', { bg: C.bg, inner: [
  `<div style="flex-grow: 1; padding: 60px 16px 0 16px; display: flex; flex-direction: column; gap: 12px;">`,
  `<div style="padding: 0 4px;">${h1('Réservations')}</div>`,
  resa('Mercredi 23 septembre, 5 h 45', 'Gare Centrale vers l\'aéroport Montréal-Trudeau', 'Neo Premium · forfait 55,00 $ · vol AC 870', 'Chauffeur confirmé', 'ok'),
  resa('Vendredi 25 septembre, 18 h 30', 'Vieux-Port vers Outremont', 'Neo XL · 6 places · 41,62 $', 'En attente d\'un chauffeur', 'wait'),
  `<div style="padding: 0 4px;">${p('Modifiable jusqu\'à 30 minutes avant le départ. Rappel la veille et dès qu\'un chauffeur est confirmé.', 14)}</div>`,
  grow(), btn('Planifier une course', 'primary', { ic: icon('plus', 20, '#FFFFFF') }), '<div style="height: 12px;"></div>', `</div>`,
  tabbar('client', 1)
].join('\n') });

// 13. Historique et reçus
const hist = (d, r, a) => `<button type="button" style="min-height: 74px; border: 0; border-bottom: 1px solid ${C.soft}; background: transparent; display: flex; align-items: center; gap: 12px; text-align: left; padding: 0;"><div style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 16px; font-weight: 600; color: ${C.ink};">${r}</span><span style="font-size: 14px; color: ${C.grey};">${d}</span></div><div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;"><span style="font-size: 16px; font-weight: 800; color: ${C.ink};">${a}</span><span style="font-size: 13px; font-weight: 600; color: ${C.blue};">Facture PDF</span></div></button>`;
add('Client-13-Historique.dc.html', 'historique et reçus', { inner: [
  `<div style="flex-grow: 1; padding: 60px 20px 0 20px; display: flex; flex-direction: column; gap: 10px;">`, h1('Historique'),
  `<div style="display: flex; gap: 8px;">${chip('Septembre 2026', true)}${chip('Exporter')}</div>`,
  `<div style="display: flex; flex-direction: column;">${[
    hist('Mardi 22 septembre, 9 h 06 · Neo Premium', 'Rue Sherbrooke Ouest vers Avenue du Parc', '31,56 $'),
    hist('Samedi 19 septembre, 23 h 40 · Neo XL', 'Vieux-Port vers Rosemont', '41,62 $'),
    hist('Jeudi 17 septembre, 5 h 45 · Forfait aéroport', 'Plateau vers l\'aéroport Montréal-Trudeau', '55,00 $'),
    hist('Lundi 14 septembre, 8 h 12 · Neo Premium', 'Verdun vers Gare Centrale', '23,40 $'),
    hist('Vendredi 11 septembre, 18 h 02 · Neo Prestige', 'Westmount vers Place des Arts', '38,46 $')].join('')}</div>`,
  `</div>`, tabbar('client', 2)
].join('\n') });

// 14. Profil
add('Client-14-Profil.dc.html', 'profil', { inner: [
  `<div style="flex-grow: 1; padding: 60px 20px 0 20px; display: flex; flex-direction: column; gap: 8px;">`,
  `<div style="display: flex; align-items: center; gap: 14px;">${avatar('CR', 60)}<div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 24px; font-weight: 800;">Camille R.</div><span style="font-size: 14px; color: ${C.grey};">514 555 0142 · français</span></div></div>`,
  `<div style="display: flex; flex-direction: column;">${[
    row({ ic: 'heart', title: 'Chauffeurs favoris et préférences', sub: 'Samuel T. · trajet calme, 21 °C', h: 58 }),
    row({ ic: 'pin', title: 'Lieux enregistrés', sub: 'Domicile, travail', h: 58 }),
    row({ ic: 'card', title: 'Modes de paiement', sub: 'Visa •••• 4242', h: 58 }),
    row({ ic: 'gift', title: 'Crédits et parrainage', sub: 'Votre code : CAMILLE-7Q', h: 58 }),
    row({ ic: 'bell', title: 'Notifications', h: 58 }),
    row({ ic: 'lock', title: 'Confidentialité et consentements', sub: 'Consulter, corriger ou récupérer mes renseignements', h: 58 }),
    row({ ic: 'trash', title: 'Supprimer mon compte', col: C.bad, h: 58 })].join('')}</div>`,
  `</div>`, tabbar('client', 4)
].join('\n') });

// 15. Assistance
const bub = (t, me) => `<div style="align-self: ${me ? 'flex-end' : 'flex-start'}; max-width: 82%; padding: 12px 14px; border-radius: 18px; background: ${me ? C.blue : C.bg}; color: ${me ? '#FFFFFF' : C.ink}; font-size: 15px; line-height: 1.4;">${t}</div>`;
add('Client-15-Assistance.dc.html', 'assistance', { inner: [
  `<div style="flex-grow: 1; padding: 60px 20px 12px 20px; display: flex; flex-direction: column; gap: 12px;">`,
  `<div style="display: flex; justify-content: space-between; align-items: center;">${h1('Assistance')}${pill('24 h sur 24', 'ok')}</div>`,
  bub('Bonjour Camille. Je suis l\'assistant de Neomoov. Comment puis-je vous aider ?', false),
  bub('J\'ai oublié mon parapluie dans la voiture ce matin.', true),
  bub('Je vois votre course de 9 h 06 avec Samuel. Je lui écris tout de suite et je vous tiens au courant ici.', false),
  `<div style="display: flex; flex-wrap: wrap; gap: 8px;">${chip('Un objet oublié')}${chip('Ma facture')}${chip('Un prix à vérifier')}</div>`,
  grow(),
  `<div style="display: flex; gap: 8px;">${btn('Parler à une personne', 'secondary', { h: 52, flex: 'flex-grow: 1;', size: 15 })}${btn('Appeler', 'neutral', { h: 52, ic: icon('phone', 20, C.blue), size: 15 })}</div>`,
  `<div style="height: 52px; box-sizing: border-box; border: 1px solid ${C.line}; border-radius: 26px; background: ${C.bg}; display: flex; align-items: center; padding: 0 18px; font-size: 16px; color: ${C.grey};">Écrire un message</div>`,
  `</div>`, tabbar('client', 3)
].join('\n') });

register('client', out);
console.log(out.length + ' écrans client écrits : ' + out.map(o => o.file).join(', '));
