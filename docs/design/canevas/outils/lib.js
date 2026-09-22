// Composants communs des maquettes Neomoov (lots 2 et suivants).
// Chaque écran produit reste un fichier .dc.html autonome, modifiable dans l'éditeur du canevas.
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, '..', 'project');

const C = { blue: '#0B5FB5', blue2: '#1485E0', green: '#6CC04A', ink: '#2C3A4A', grey: '#4A5A70', line: '#DCE3EC', soft: '#EEF2F7', bg: '#F4F7FB', tint: '#E3F1FC', sel: '#F4F8FE', red: '#C62828', okBg: '#EAF6E1', ok: '#2F6B14', waitBg: '#FFF1D6', wait: '#7A4B00', badBg: '#FDE7E7', bad: '#9B1C1C', dBg: '#10171F', dSurf: '#1B2633', dLine: '#2F3E50', dText: '#F3F6F9', dGrey: '#AAB6C4', onGreen: '#16260C' };
const GRAD = 'linear-gradient(90deg, #0B5FB5 0%, #1485E0 55%, #6CC04A 100%)';
const FONT = 'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,600;0,700;0,800;1,800&amp;family=Nunito:wght@400;500;600;700;800&amp;display=swap';

const I = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', cal: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', msg: 'M4 5h16v11H9l-5 4z', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  wallet: 'M3 7h18v12H3zM3 11h18M16 15h2', menu: 'M4 7h16M4 12h16M4 17h16', chev: 'M9 6l6 6-6 6', back: 'M15 6l-6 6 6 6', check: 'M5 12l5 5 9-10',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z', alert: 'M12 4l9 16H3zM12 10v4M12 17h.01', doc: 'M7 3h7l4 4v14H7zM14 3v4h4', share: 'M12 15V4M8 8l4-4 4 4M5 13v6h14v-6',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z', card: 'M3 6h18v12H3zM3 10h18M7 15h3', pin: 'M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  arrow: 'M5 12h14M13 6l6 6-6 6', plus: 'M12 5v14M5 12h14', lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  bell: 'M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4', trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13', play: 'M8 5l11 7-11 7z', car: 'M3 15v-3l4-2 4-6h11l5 6 4 1v4h-3M10 15h13',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z', nav: 'M12 3l7 18-7-4-7 4z', cam: 'M4 8h4l2-3h4l2 3h4v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0'
};

const icon = (n, s = 22, col = C.ink, sw = 2.2, fill = 'none') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${fill}" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${I[n]}"></path></svg>`;
const starFull = (s = 14, col = C.blue) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${col}" aria-hidden="true"><path d="${I.star}"></path></svg>`;

function page({ file, title, w = 390, h = 844, bodyBg = C.bg, bg = '#FFFFFF', color = C.ink, pad = '0', gap = 0, inner }) {
  const html = `<!doctype html>
<html lang="fr-CA">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="${FONT}" rel="stylesheet">
<style>
body{margin:0;font-family:Nunito,"Segoe UI",system-ui,sans-serif;background:${bodyBg};color:${color}}
button,input{font-family:inherit}
a{color:${C.blue}}a:hover{color:#084A8F}
[style*="font-weight: 800"],[style*="font-weight: 700"],h1,h2{font-family:Montserrat,"Segoe UI",system-ui,sans-serif}
</style>
</helmet>
<div style="width: ${w}px; height: ${h}px; box-sizing: border-box; padding: ${pad}; display: flex; flex-direction: column; gap: ${gap}px; background: ${bg}; color: ${color}; overflow: hidden;">
${inner}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
renderVals() { return {}; }
}
</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT, file), html);
  return file;
}

const TABS = {
  client: [['Accueil', 'home'], ['Réservations', 'cal'], ['Historique', 'clock'], ['Assistance', 'msg'], ['Profil', 'user']],
  driver: [['Accueil', 'home'], ['Planifiées', 'cal'], ['Revenus', 'wallet'], ['Messages', 'msg'], ['Menu', 'menu']]
};
const tabbar = (kind, active) => `<div style="height: 76px; flex-shrink: 0; border-top: 1px solid ${C.line}; background: #FFFFFF; display: flex; align-items: stretch; padding: 0 6px;">
${TABS[kind].map(([l, ic], i) => { const col = i === active ? C.blue : C.grey; return `<button type="button" style="flex: 1 1 0; min-width: 0; border: 0; background: transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: ${col};">${icon(ic, 24, col, 2)}<span style="font-size: 12px; font-weight: ${i === active ? 700 : 500};">${l}</span></button>`; }).join('\n')}
</div>`;

const h1 = (t, size = 32) => `<div style="font-size: ${size}px; font-weight: 800; letter-spacing: -0.6px; line-height: 1.1;">${t}</div>`;
const h2 = (t, size = 18) => `<div style="font-size: ${size}px; font-weight: 700;">${t}</div>`;
const p = (t, size = 15, col = C.grey) => `<div style="font-size: ${size}px; line-height: 1.45; color: ${col};">${t}</div>`;
const grow = () => '<div style="flex-grow: 1;"></div>';

const PILL = { ok: [C.okBg, C.ok], wait: [C.waitBg, C.wait], info: [C.tint, C.blue], bad: [C.badBg, C.bad], solid: [C.blue, '#FFFFFF'], dark: [C.ink, '#FFFFFF'] };
const pill = (t, kind = 'info', size = 13) => `<span style="padding: 5px 10px; border-radius: 999px; background: ${PILL[kind][0]}; color: ${PILL[kind][1]}; font-size: ${size}px; font-weight: 600; white-space: nowrap;">${t}</span>`;

const BTN = { primary: `border: 0; background: ${C.blue}; color: #FFFFFF;`, secondary: `border: 1.5px solid ${C.blue}; background: #FFFFFF; color: ${C.blue};`, green: `border: 0; background: ${C.green}; color: ${C.onGreen};`, danger: `border: 0; background: ${C.red}; color: #FFFFFF;`, neutral: `border: 1px solid ${C.line}; background: #FFFFFF; color: ${C.ink};`, ghost: `border: 0; background: transparent; color: ${C.blue};` };
const btn = (t, v = 'primary', { h = 56, flex = '', ic = '', size = 17 } = {}) => `<button type="button" style="${flex} height: ${h}px; ${BTN[v]} border-radius: 14px; font-size: ${size}px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px;">${ic}${t}</button>`;
const backBtn = () => `<button type="button" aria-label="Retour" style="width: 44px; height: 44px; border: 0; border-radius: 22px; background: ${C.bg}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${icon('back', 22, C.ink, 2.4)}</button>`;
const topbar = (t) => `<div style="display: flex; align-items: center; gap: 12px;">${backBtn()}<div style="font-size: 20px; font-weight: 700;">${t}</div></div>`;

const row = ({ ic, title, sub = '', right = '', h = 64, chev = true, col = C.ink }) => `<button type="button" style="min-height: ${h}px; border: 0; border-bottom: 1px solid ${C.soft}; background: transparent; display: flex; align-items: center; gap: 14px; text-align: left; padding: 6px 0;">
${ic ? `<div style="width: 40px; height: 40px; border-radius: 20px; background: ${C.tint}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${icon(ic, 20, C.blue)}</div>` : ''}
<div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 16px; font-weight: 600; color: ${col};">${title}</span>${sub ? `<span style="font-size: 14px; color: ${C.grey};">${sub}</span>` : ''}</div>
${right}${chev ? icon('chev', 18, C.grey) : ''}
</button>`;

const toggle = (on) => `<span style="width: 50px; height: 30px; border-radius: 15px; background: ${on ? C.blue : '#C5CFDB'}; display: flex; align-items: center; padding: 3px; box-sizing: border-box; justify-content: ${on ? 'flex-end' : 'flex-start'}; flex-shrink: 0;"><span style="width: 24px; height: 24px; border-radius: 12px; background: #FFFFFF;"></span></span>`;
const kv = (l, v, { bold = false, col = C.ink, size = 15 } = {}) => `<div style="display: flex; justify-content: space-between; gap: 12px; font-size: ${size}px;"><span style="color: ${bold ? col : C.grey}; font-weight: ${bold ? 700 : 500};">${l}</span><span style="color: ${col}; font-weight: ${bold ? 800 : 600}; white-space: nowrap;">${v}</span></div>`;
const card = (inner, { pad = 14, bg = '#FFFFFF', border = `1px solid ${C.line}`, gap = 8, radius = 16 } = {}) => `<div style="background: ${bg}; border: ${border}; border-radius: ${radius}px; padding: ${pad}px; display: flex; flex-direction: column; gap: ${gap}px;">${inner}</div>`;
const chip = (t, sel = false) => `<button type="button" style="height: 44px; padding: 0 14px; border: ${sel ? '2px solid ' + C.blue : '1px solid ' + C.line}; border-radius: 999px; background: ${sel ? C.sel : '#FFFFFF'}; color: ${C.ink}; font-size: 14px; font-weight: 600;">${t}</button>`;
const slide = (t) => `<div style="height: 68px; border-radius: 18px; background: ${C.tint}; display: flex; align-items: center; padding: 5px; box-sizing: border-box; gap: 16px;"><div style="width: 76px; height: 58px; border-radius: 14px; background: ${C.blue}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${icon('arrow', 26, '#FFFFFF', 2.4)}</div><span style="font-size: 18px; font-weight: 700; color: ${C.blue};">${t}</span></div>`;
const avatar = (t, s = 56) => `<div style="width: ${s}px; height: ${s}px; border-radius: ${s / 2}px; background: ${C.tint}; color: ${C.blue}; font-size: ${Math.round(s * 0.36)}px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${t}</div>`;
const bar = (pct, { h = 10, track = C.tint, fill = GRAD } = {}) => `<div style="height: ${h}px; border-radius: ${h / 2}px; background: ${track};"><div style="width: ${pct}%; height: ${h}px; border-radius: ${h / 2}px; background: ${fill};"></div></div>`;

// Carte stylisée. route : tracé SVG du trajet. car : [x, y] du véhicule.
function map(h, { route = '', car = null, from = null, to = null, me = null, dark = false } = {}) {
  const g = dark ? C.dSurf : '#E8EEF6', rd = dark ? C.dLine : '#FFFFFF';
  return `<svg viewBox="0 0 390 ${h}" width="390" height="${h}" aria-hidden="true" style="display: block;">
<rect width="390" height="${h}" fill="${g}"></rect>
${dark ? '' : `<rect x="240" y="${Math.round(h * 0.12)}" width="110" height="${Math.round(h * 0.22)}" rx="10" fill="#D5EBD9"></rect>`}
<g stroke="${rd}" stroke-width="10" stroke-linecap="round" fill="none"><path d="M-10 ${Math.round(h * 0.3)} H400"></path><path d="M-10 ${Math.round(h * 0.7)} H400"></path><path d="M80 -10 V${h + 10}"></path><path d="M210 -10 V${h + 10}"></path><path d="M330 -10 V${h + 10}"></path></g>
<g stroke="${rd}" stroke-width="5" stroke-linecap="round" fill="none"><path d="M-10 ${Math.round(h * 0.5)} H400"></path><path d="M145 -10 V${h + 10}"></path><path d="M270 -10 V${h + 10}"></path></g>
${route ? `<path d="${route}" stroke="${dark ? '#5FA8EE' : C.blue}" stroke-width="5" fill="none" stroke-linejoin="round" stroke-linecap="round"></path>` : ''}
${from ? `<circle cx="${from[0]}" cy="${from[1]}" r="9" fill="${C.green}" stroke="${rd}" stroke-width="3"></circle>` : ''}
${to ? `<rect x="${to[0] - 9}" y="${to[1] - 9}" width="18" height="18" rx="4" fill="${C.red}" stroke="${rd}" stroke-width="3"></rect>` : ''}
${me ? `<circle cx="${me[0]}" cy="${me[1]}" r="32" fill="${C.blue2}" fill-opacity="0.16"></circle><circle cx="${me[0]}" cy="${me[1]}" r="10" fill="${C.blue}" stroke="#FFFFFF" stroke-width="4"></circle>` : ''}
${car ? `<g transform="translate(${car[0] - 16} ${car[1] - 16})"><rect width="32" height="32" rx="16" fill="${C.blue}" stroke="#FFFFFF" stroke-width="3"></rect><path d="M9 19v-3l2-1 2-4h6l3 4 2 1v3" stroke="#FFFFFF" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"></path></g>` : ''}
</svg>`;
}
const sheet = (inner, { gap = 14, pad = '12px 20px 0 20px' } = {}) => `<div style="flex-grow: 1; margin-top: -20px; border-radius: 22px 22px 0 0; background: #FFFFFF; box-shadow: 0 -6px 20px rgba(10,27,51,0.10); padding: ${pad}; display: flex; flex-direction: column; gap: ${gap}px; position: relative;"><div style="align-self: center; width: 40px; height: 4px; border-radius: 2px; background: ${C.line};"></div>${inner}</div>`;
const mapBlock = (h, opts, overlay = '') => `<div style="position: relative; height: ${h}px; flex-shrink: 0;">${map(h, opts)}${overlay}</div>`;
const bottom = (inner) => `<div style="flex-shrink: 0; padding: 10px 20px 24px 20px; background: #FFFFFF; border-top: 1px solid ${C.soft}; display: flex; gap: 10px; align-items: center;">${inner}</div>`;

// Ajoute des artboards à l'index du canevas, en rangées sous les écrans existants d'une page.
function register(pageId, files, { w = 390, h = 844, gap = 80, perRow = 7, radius = 28, extra = {} } = {}) {
  const idx = path.join(OUT, 'canvas.json'), cv = JSON.parse(fs.readFileSync(idx, 'utf8'));
  const onPage = Object.entries(cv.boards).filter(([, b]) => b.page === pageId);
  let n = onPage.filter(([k]) => !files.some(f => f.file === k)).length;
  files.forEach(({ file, title }) => {
    if (!cv.boards[file]) { const r = Math.floor(n / perRow), c = n % perRow; cv.boards[file] = Object.assign({ x: c * (w + gap), y: r * (h + 120), w, h, title, page: pageId }, radius ? { radius } : {}, extra); cv.order.push(file); n++; }
    else cv.boards[file].title = title;
  });
  fs.writeFileSync(idx, JSON.stringify(cv, null, 2) + '\n');
}

// Gabarit My Hub (navigation latérale et en-tête), tableau et petit bouton. Partagés par les lots 2 et 3.
const NAV = ['Tableau de bord', 'Répartition', 'Chauffeurs', 'Véhicules', 'Clients', 'Tarifs et zones', 'Packs et règlements', 'Promotions', 'Facturation et taxes', 'Incidents et sécurité', 'Agents IA', 'Rapports', 'Paramètres'];
const mark = (dark, size = 20) => `<div style="display: flex; align-items: center; gap: 10px;"><div style="width: ${size + 8}px; height: 8px; border-radius: 4px; background: ${GRAD};"></div><span style="font-size: ${size}px; font-weight: 800; font-style: italic; letter-spacing: -0.4px; color: ${dark ? '#FFFFFF' : C.ink};">neomoov</span></div>`;
const hub = (active, title, sub, action, content) => `<div style="display: flex; flex-grow: 1; min-height: 0;">
<nav aria-label="Modules" style="width: 232px; flex-shrink: 0; background: ${C.dBg}; padding: 24px 14px; display: flex; flex-direction: column; gap: 4px;"><div style="padding: 0 10px 20px 10px;">${mark(true)}</div>${NAV.map((l, i) => `<button type="button" style="height: 44px; border: 0; border-radius: 10px; background: ${i === active ? C.dSurf : 'transparent'}; color: ${i === active ? '#FFFFFF' : C.dGrey}; font-size: 15px; font-weight: ${i === active ? 700 : 500}; text-align: left; padding: 0 12px;">${l}</button>`).join('')}</nav>
<div style="flex-grow: 1; min-width: 0; padding: 24px 28px; display: flex; flex-direction: column; gap: 16px;"><div style="display: flex; justify-content: space-between; align-items: center;"><div style="display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">${title}</div><div style="font-size: 14px; color: ${C.grey};">${sub}</div></div>${action}</div>${content}</div></div>`;
const table = (cols, rows) => `<div style="background: #FFFFFF; border: 1px solid ${C.line}; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column;"><div style="display: flex; gap: 12px; padding: 0 16px; min-height: 42px; align-items: center; background: ${C.bg}; border-bottom: 1px solid ${C.line}; font-size: 13px; font-weight: 700; color: ${C.grey};">${cols.map(([l, w, r]) => `<span style="${w ? 'width: ' + w + 'px; flex-shrink: 0;' : 'flex-grow: 1;'} text-align: ${r ? 'right' : 'left'};">${l}</span>`).join('')}</div>${rows.map(r => `<div style="display: flex; gap: 12px; padding: 0 16px; min-height: 50px; align-items: center; border-bottom: 1px solid ${C.soft}; font-size: 14px;">${r.map((v, i) => `<span style="${cols[i][1] ? 'width: ' + cols[i][1] + 'px; flex-shrink: 0;' : 'flex-grow: 1; min-width: 0;'} text-align: ${cols[i][2] ? 'right' : 'left'};">${v}</span>`).join('')}</div>`).join('')}</div>`;
const sbtn = (t, v = 'neutral') => btn(t, v, { h: 40, size: 14 });
const stat = (v, l, col = C.ink) => card(`<span style="font-size: 26px; font-weight: 800; color: ${col};">${v}</span><span style="font-size: 13px; color: ${C.grey};">${l}</span>`, { gap: 2 });

module.exports = { C, GRAD, I, icon, starFull, page, tabbar, h1, h2, p, grow, pill, btn, backBtn, topbar, row, toggle, kv, card, chip, slide, avatar, bar, map, sheet, mapBlock, bottom, register, OUT, NAV, mark, hub, table, sbtn, stat };
