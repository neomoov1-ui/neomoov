// Lot 2, application chauffeur : 13 écrans. Lancer : node outils/lot2-chauffeur.js
const { C, icon, starFull, page, tabbar, h1, h2, p, grow, pill, btn, topbar, row, kv, card, chip, slide, avatar, bar, sheet, mapBlock, bottom, register } = require('./lib');
const PAD = '60px 20px 24px 20px';
const out = [];
const add = (file, title, opts, note = '') => { page(Object.assign({ file, title: 'Chauffeur, ' + title }, opts)); out.push({ file, title: (out.length + 8) + '. ' + title.charAt(0).toUpperCase() + title.slice(1) + note }); };
const banner = (dot, t, s) => `<div style="position: absolute; left: 12px; right: 12px; top: 52px; border-radius: 16px; background: ${C.ink}; color: #FFFFFF; padding: 14px 16px; display: flex; align-items: center; gap: 12px;"><span style="width: 12px; height: 12px; border-radius: ${dot === C.red ? 3 : 6}px; background: ${dot}; flex-shrink: 0;"></span><div style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 17px; font-weight: 700;">${t}</span><span style="font-size: 15px; color: #C9D6E6;">${s}</span></div></div>`;
const big = (a, b) => `<div style="display: flex; align-items: baseline; gap: 10px;"><span style="font-size: 38px; font-weight: 800; letter-spacing: -1px; line-height: 1;">${a}</span><span style="font-size: 17px; color: ${C.grey};">${b}</span></div>`;
const contact = () => `<div style="display: flex; gap: 10px;">${btn('Appeler', 'neutral', { flex: 'flex: 1 1 0;', ic: icon('phone', 20, C.blue), size: 16 })}${btn('Message', 'neutral', { flex: 'flex: 1 1 0;', ic: icon('msg', 20, C.blue), size: 16 })}${btn('SOS', 'danger', { size: 16 })}</div>`;
const check = (t, ok) => `<div style="display: flex; align-items: center; gap: 10px; font-size: 15px;">${icon(ok ? 'check' : 'alert', 20, ok ? C.ok : C.wait, 2.6)}<span>${t}</span></div>`;

// 8. Accueil hors ligne
add('Chauffeur-08-HorsLigne.dc.html', 'accueil, hors ligne', { inner: [
  mapBlock(330, { me: [210, 165] }),
  sheet([
    `<div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 24px; font-weight: 800;">Vous êtes hors ligne</div>${p('Tout est en ordre. Vous pouvez recevoir des courses.')}</div>`,
    card([check('Documents à jour', true), check('Formation réussie', true), check('Pack Élite actif, 38 courses restantes', true), check('Inspection Neomoov à refaire d\'ici 23 jours', false)].join(''), { bg: C.bg, gap: 10 }),
    card(`<span style="font-size: 15px; font-weight: 700;">Demain, 5 h 45 · 44,94 $</span><span style="font-size: 14px; color: ${C.grey};">LaSalle vers l'aéroport Montréal-Trudeau</span>`, { gap: 2 }),
    grow(), btn('Passer en ligne', 'green', { h: 64, size: 19 }), '<div style="height: 4px;"></div>'
  ].join('\n'), { gap: 12, pad: '12px 16px 0 16px' }),
  tabbar('driver', 0)
].join('\n') });

// 9. Inscription
const docRow = (t, s, st, k) => `<div style="display: flex; align-items: center; gap: 12px; min-height: 60px; border-bottom: 1px solid ${C.soft};">${icon('cam', 22, C.blue)}<div style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 16px; font-weight: 600;">${t}</span><span style="font-size: 13px; color: ${C.grey};">${s}</span></div>${pill(st, k)}</div>`;
add('Chauffeur-09-Inscription.dc.html', 'inscription, documents', { pad: PAD, gap: 14, inner: [
  topbar('Étape 5 de 6'), bar(83), h1('Vos documents', 28), p('Photographiez chaque pièce bien à plat. Comptez une quinzaine de minutes pour tout le dossier.'),
  `<div style="display: flex; flex-direction: column;">${[
    docRow('Permis de conduire', 'Recto et verso', 'Reçu', 'ok'), docRow('Autorisation de chauffeur', 'SAAQ, chauffeur autorisé', 'Reçu', 'ok'),
    docRow('Immatriculation', 'Au nom du propriétaire du véhicule', 'Reçu', 'ok'), docRow('Assurance du véhicule', 'Le nom doit être le vôtre', 'À refaire', 'bad'),
    docRow('Vérification mécanique', 'Conforme à la loi', 'À fournir', 'wait'), docRow('Numéros de TPS et de TVQ', 'Inscrits sur vos factures', 'Reçu', 'ok')].join('')}</div>`,
  grow(), btn('Photographier l\'assurance', 'primary', { ic: icon('cam', 20, '#FFFFFF') })
].join('\n') });

// 10. Formation
const mod = (n, t, d, st) => `<div style="display: flex; align-items: center; gap: 12px; min-height: 64px; border-bottom: 1px solid ${C.soft};"><div style="width: 40px; height: 40px; border-radius: 20px; background: ${st === 'ok' ? C.okBg : C.tint}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${icon(st === 'ok' ? 'check' : st === 'lock' ? 'lock' : 'play', 20, st === 'ok' ? C.ok : C.blue, 2.4)}</div><div style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 16px; font-weight: 600;">${n}. ${t}</span><span style="font-size: 13px; color: ${C.grey};">${d}</span></div></div>`;
add('Chauffeur-10-Formation.dc.html', 'formation', { pad: PAD, gap: 14, inner: [
  h1('Formation'), p('L\'attestation est exigée pour passer en ligne.'), bar(60), p('3 modules sur 5 réussis', 14, C.ink),
  `<div style="display: flex; flex-direction: column;">${[
    mod(1, 'Le standard Neomoov', 'Vidéo de 8 min et quiz', 'ok'), mod(2, 'Accueil et préférences du client', 'Vidéo de 6 min et quiz', 'ok'),
    mod(3, 'L\'application, étape par étape', 'Vidéo de 10 min et quiz', 'ok'), mod(4, 'Sécurité, incidents et SOS', 'Vidéo de 7 min et quiz', 'play'),
    mod(5, 'Packs, relevés et taxes', 'Vidéo de 9 min et quiz', 'lock')].join('')}</div>`,
  grow(), btn('Reprendre le module 4')
].join('\n') });

// 11. En route vers le client
add('Chauffeur-11-EnRoute.dc.html', 'en route vers le client', { inner: [
  mapBlock(360, { route: 'M80 300 V180 H210 V108', from: [210, 108], me: [80, 300] }, banner(C.green, 'Prise en charge', 'Rue Sherbrooke Ouest, près de l\'entrée principale')),
  sheet([
    big('4 min', '1,6 km'),
    `<div style="display: flex; align-items: center; gap: 12px;">${avatar('CR', 48)}<div style="flex-grow: 1; display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 17px; font-weight: 700;">Camille</span><span style="display: flex; align-items: center; gap: 4px; font-size: 14px; color: ${C.grey};">${starFull()} 4,92 · cliente fidèle · trajet calme, 21 °C</span></div></div>`,
    `<div style="display: flex; gap: 10px;">${btn('Google Maps', 'secondary', { flex: 'flex: 1 1 0;', ic: icon('nav', 20, C.blue), size: 16 })}${btn('Waze', 'secondary', { flex: 'flex: 1 1 0;', ic: icon('nav', 20, C.blue), size: 16 })}</div>`,
    contact(), grow(), slide('Glisser : je suis arrivé'), '<div style="height: 12px;"></div>'
  ].join('\n'))
].join('\n') });

// 12. Client à bord
add('Chauffeur-12-ABord.dc.html', 'client à bord', { inner: [
  mapBlock(400, { route: 'M80 330 H210 V140 H330', from: [80, 330], to: [330, 140], me: [210, 240] }, banner(C.red, 'Destination', 'Avenue du Parc, Montréal')),
  sheet([
    big('12 min', '5,3 km'),
    card(kv('Neo Premium · carte dans l\'application', '24,55 $', { bold: true, size: 16 }) + `<span style="font-size: 14px; font-weight: 700; color: ${C.ok};">Pour vous en entier. Commission Neomoov : 0 $</span>`, { bg: C.bg }),
    `<div style="display: flex; gap: 10px;">${btn('Ajouter un arrêt', 'neutral', { flex: 'flex: 1 1 0;', size: 16 })}${btn('Signaler', 'neutral', { flex: 'flex: 1 1 0;', size: 16 })}${btn('SOS', 'danger', { size: 16 })}</div>`,
    grow(), slide('Glisser pour terminer'), '<div style="height: 12px;"></div>'
  ].join('\n'))
].join('\n') });

// 13. Fin de course, paiement direct
const stars = [1, 2, 3, 4, 5].map(() => `<button type="button" aria-label="Étoile" style="width: 48px; height: 48px; border: 0; background: transparent; padding: 0;">${starFull(36)}</button>`).join('');
add('Chauffeur-13-FinDeCourse.dc.html', 'fin de course, paiement en espèces', { pad: PAD, gap: 16, inner: [
  p('Course terminée · Neo Premium'), `<div style="font-size: 46px; font-weight: 800; letter-spacing: -1.4px; line-height: 1;">24,55 $</div>`,
  `<span style="font-size: 15px; font-weight: 700; color: ${C.ok};">Votre tarif, sans commission</span>`,
  card([h2('À recevoir de la cliente, en espèces', 16), `<div style="font-size: 34px; font-weight: 800; letter-spacing: -0.8px;">31,56 $</div>`, p('Ce montant comprend 7,01 $ de frais de service, de redevance et de taxes. La part qui ne vous revient pas sera portée à votre relevé du vendredi.', 14)].join(''), { bg: C.waitBg, border: '0', gap: 6 }),
  btn('J\'ai reçu 31,56 $', 'secondary'),
  h2('Comment était Camille ?'), `<div style="display: flex; gap: 6px;">${stars}</div>`,
  `<div style="display: flex; flex-wrap: wrap; gap: 8px;">${chip('Ponctuelle', true)}${chip('Courtoise', true)}${chip('Adresse précise')}</div>`,
  grow(), btn('Terminer')
].join('\n') });

// 14. Signaler un problème
add('Chauffeur-14-Signaler.dc.html', 'signaler un problème', { pad: PAD, gap: 10, inner: [
  topbar('Signaler un problème'), p('Choisissez ce qui décrit le mieux la situation. Un opérateur est prévenu quand il le faut.'),
  `<div style="display: flex; flex-direction: column;">${[
    ['Client introuvable', 'Après 5 minutes et deux tentatives de contact'], ['Aucun endroit où s\'arrêter', ''], ['Trop de passagers', 'Plus de places que la catégorie réservée'],
    ['Bagages trop volumineux', ''], ['Mineur non accompagné', ''], ['Pas de siège d\'enfant', ''], ['Comportement du client', 'Un opérateur vous rappelle'], ['Problème de véhicule', ''], ['Autre', '']
  ].map(([t, s]) => row({ title: t, sub: s, h: 60 })).join('')}</div>`
].join('\n') });

// 15. Détail d'une course
add('Chauffeur-15-DetailCourse.dc.html', 'détail d\'une course', { inner: [
  `<div style="padding: 60px 20px 12px 20px; display: flex; flex-direction: column; gap: 6px;">${topbar('Détail de la course')}${p('Neo Premium · lundi 14 septembre, 7 h 12 · NM-260914-0012', 14)}<div style="font-size: 42px; font-weight: 800; letter-spacing: -1.2px;">28,55 $</div></div>`,
  mapBlock(170, { route: 'M80 120 H210 V50 H330', from: [80, 120], to: [330, 50] }),
  `<div style="flex-grow: 1; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;">`,
  `<div style="display: flex; gap: 24px;">${[['Durée', '18 min 04 s'], ['Distance', '8,0 km']].map(([l, v]) => `<div style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 14px; color: ${C.grey};">${l}</span><span style="font-size: 18px; font-weight: 700;">${v}</span></div>`).join('')}</div>`,
  p('Rue Sherbrooke Ouest vers Avenue du Parc, Montréal', 15, C.ink),
  card([kv('Tarif de la course', '24,55 $'), kv('Pourboire', '4,00 $'), kv('Commission Neomoov', '0,00 $', { col: C.ok, bold: true }), kv('Total pour vous', '28,55 $', { bold: true, size: 17 })].join(''), { bg: C.bg }),
  p('Payée par carte dans l\'application. 1 course du Pack Élite consommée. Prix identique au prix annoncé à la cliente.', 14),
  grow(), btn('Voir la facture remise à la cliente', 'ghost', { h: 48, size: 15 }), `</div>`
].join('\n') });

// 16. Où va l'argent payé par mes clients
const seg = (pct, off, col) => `<circle cx="70" cy="70" r="54" fill="none" stroke="${col}" stroke-width="20" stroke-dasharray="${(339.29 * pct / 100).toFixed(1)} 339.29" stroke-dashoffset="${(-339.29 * off / 100).toFixed(1)}" transform="rotate(-90 70 70)"></circle>`;
const leg = (col, l, v) => `<div style="display: flex; align-items: center; gap: 10px; min-height: 40px; border-bottom: 1px solid ${C.soft}; font-size: 15px;"><span style="width: 12px; height: 12px; border-radius: 6px; background: ${col}; flex-shrink: 0;"></span><span style="flex-grow: 1;">${l}</span><span style="font-weight: 700;">${v}</span></div>`;
add('Chauffeur-16-Repartition.dc.html', 'où va l\'argent payé par mes clients', { pad: PAD, gap: 14, inner: [
  topbar('Où va l\'argent ?'), p('Exemple : une course Neo Premium payée 31,56 $ par la cliente.'),
  `<div style="display: flex; align-items: center; gap: 20px;"><svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">${seg(78, 0, C.blue)}${seg(6, 78, C.green)}${seg(3, 84, C.wait)}${seg(13, 87, '#9AA7B8')}</svg><div style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 40px; font-weight: 800; letter-spacing: -1px; color: ${C.blue};">78 %</span><span style="font-size: 15px; color: ${C.grey};">du paiement vous revient</span></div></div>`,
  `<div style="display: flex; flex-direction: column;">${leg(C.blue, 'Vous : le tarif de la course', '24,55 $')}${leg(C.green, 'Frais de service Neomoov', '2,00 $')}${leg(C.wait, 'Redevance gouvernementale', '0,90 $')}${leg('#9AA7B8', 'TPS et TVQ', '4,11 $')}</div>`,
  card(`<span style="font-size: 17px; font-weight: 800; color: ${C.ok};">Commission Neomoov : 0,00 $</span>` + p('Votre seul coût envers Neomoov est votre pack : 1,69 $ par course avec le Pack Élite.', 14), { bg: C.okBg, border: '0', gap: 4 }),
  p('Le pourboire s\'ajoute et vous revient en totalité.', 14)
].join('\n') });

// 17. Mes réservations
const mine = (when, price, route, st, k, cta) => card(`<div style="display: flex; justify-content: space-between; align-items: center;"><span style="font-size: 15px; font-weight: 700;">${when}</span>${pill(st, k)}</div><div style="display: flex; align-items: baseline; gap: 10px;"><span style="font-size: 26px; font-weight: 800;">${price}</span></div><span style="font-size: 15px;">${route}</span>${cta}`);
add('Chauffeur-17-MesReservations.dc.html', 'mes réservations', { bg: C.bg, inner: [
  `<div style="flex-grow: 1; padding: 60px 16px 0 16px; display: flex; flex-direction: column; gap: 12px;">`, `<div style="padding: 0 4px;">${h1('Mes réservations', 28)}</div>`,
  mine('Demain, 5 h 45', '44,94 $', 'LaSalle vers l\'aéroport Montréal-Trudeau (YUL)', 'À confirmer', 'wait', `<div style="display: flex; gap: 8px;">${btn('Confirmer ma présence', 'green', { h: 48, flex: 'flex-grow: 1;', size: 15 })}${btn('Me retirer', 'neutral', { h: 48, size: 15 })}</div>`),
  mine('Vendredi 25 septembre, 18 h 30', '62,31 $', 'Vieux-Port vers Outremont · Neo XL', 'Confirmée', 'ok', ''),
  card(p('Repassez en ligne 30 minutes avant la prise en charge, sinon la course passe à un autre chauffeur. Vous pouvez vous retirer sans effet jusqu\'à 60 minutes avant.', 14, C.blue), { bg: C.tint, border: '0' }),
  grow(), `</div>`, tabbar('driver', 1)
].join('\n') });

// 18. Tableau de conduite
const dist = (n, pct, c) => `<div style="display: flex; align-items: center; gap: 10px; font-size: 14px;"><span style="width: 28px;">${n} ★</span><div style="flex-grow: 1; height: 8px; border-radius: 4px; background: ${C.soft};"><div style="width: ${pct}%; height: 8px; border-radius: 4px; background: ${C.blue};"></div></div><span style="width: 32px; text-align: right; font-weight: 700;">${c}</span></div>`;
const stat = (v, l) => `<div style="flex: 1 1 0; border: 1px solid ${C.line}; border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 24px; font-weight: 800;">${v}</span><span style="font-size: 13px; color: ${C.grey};">${l}</span></div>`;
add('Chauffeur-18-TableauConduite.dc.html', 'tableau de conduite', { pad: PAD, gap: 14, inner: [
  h1('Ma conduite', 28),
  card(`<div style="display: flex; align-items: baseline; gap: 8px;"><span style="font-size: 40px; font-weight: 800; letter-spacing: -1px;">4,96</span><span style="font-size: 15px; color: ${C.grey};">sur vos 200 dernières notes</span></div>` + [dist(5, 96, 192), dist(4, 3, 6), dist(3, 1, 1), dist(2, 0, 0), dist(1, 1, 1)].join(''), { gap: 8 }),
  `<div style="display: flex; gap: 10px;">${stat('97 %', 'Ponctualité')}${stat('2 sur 100', 'Annulations')}${stat('94 %', 'Offres acceptées')}</div>`,
  h2('Pour progresser'),
  card(p('Deux clients ont trouvé l\'habitacle trop chaud cette semaine. Pensez à regarder la température demandée avant l\'arrivée.', 15, C.ink), { bg: C.bg }),
  p('Mis à jour chaque jour. Les notes liées à la circulation ou à un fait hors de votre contrôle ne comptent pas.', 14)
].join('\n') });

// 19. Sécurité et assistance
add('Chauffeur-19-Securite.dc.html', 'sécurité et assistance', { pad: PAD, gap: 14, inner: [
  h1('Sécurité', 28),
  `<button type="button" style="height: 92px; border: 0; border-radius: 18px; background: ${C.red}; color: #FFFFFF; display: flex; align-items: center; gap: 14px; padding: 0 20px; text-align: left;">${icon('alert', 32, '#FFFFFF', 2.4)}<span style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 22px; font-weight: 800;">SOS</span><span style="font-size: 14px;">Alerte immédiate à l'opérateur, avec votre position</span></span></button>`,
  `<div style="display: flex; flex-direction: column;">${[
    row({ ic: 'phone', title: 'Appeler le 911', sub: 'Votre position et la course s\'affichent pour la lire à l\'agent' }),
    row({ ic: 'alert', title: 'Signaler un incident', sub: 'Accident, agression, objet dangereux, malaise' }),
    row({ ic: 'share', title: 'Partager ma position avec un proche', sub: 'Lien de suivi, à arrêter quand vous voulez' }),
    row({ ic: 'doc', title: 'Preuve de course', sub: 'À montrer lors d\'un contrôle routier' }),
    row({ ic: 'msg', title: 'Assistance Neomoov', sub: 'Assistant, puis une personne au besoin' })].join('')}</div>`
].join('\n') });

// 20. Preuve de course (proposition E1)
const line = (l, v) => `<div style="display: flex; gap: 12px; min-height: 42px; align-items: center; border-bottom: 1px solid ${C.soft}; font-size: 15px;"><span style="width: 120px; color: ${C.grey}; flex-shrink: 0;">${l}</span><span style="font-weight: 600;">${v}</span></div>`;
add('Chauffeur-20-PreuveDeCourse.dc.html', 'preuve de course', { pad: PAD, gap: 14, inner: [
  topbar('Preuve de course'),
  card(`<div style="display: flex; justify-content: space-between; align-items: center;"><span style="font-size: 18px; font-weight: 800;">Neomoov</span>${pill('Course en cours', 'ok')}</div><span style="font-size: 14px; color: ${C.grey};">Exploitant : Groupe NSK Inc.</span>`, { gap: 4 }),
  `<div style="display: flex; flex-direction: column;">${[
    line('Course', 'NM-260922-0187'), line('Début', '22 septembre 2026, 9 h 06'), line('Passager', 'Camille R.'), line('Origine', 'Rue Sherbrooke Ouest, Montréal'),
    line('Destination', 'Avenue du Parc, Montréal'), line('Chauffeur', 'Samuel Tremblay'), line('Véhicule', 'Tesla Model 3 · N52 KTB'), line('Places', '4')].join('')}</div>`,
  p('Document à présenter à un agent de la paix ou à un inspecteur. Il se met à jour à chaque course.', 14)
].join('\n') }, ' (proposition à arbitrer)');

register('chauffeur', out);
console.log(out.length + ' écrans chauffeur écrits');
