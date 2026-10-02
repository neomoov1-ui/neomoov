// Génère les versions HTML « prêtes pour Brevo » des courriels à partir de livraison/marketing/emails_source.json :
// même gabarit que le lot du 30 septembre (600 px, lien natif {{ unsubscribe }}), prénom par condition Brevo
// ({% if contact.PRENOM %}) pour éviter « Bonjour , » quand le prénom manque. Deux variantes par courriel ne sont pas
// produites : le texte de fin suit l'état des ventes au moment de l'import (--vente pour la version « ventes ouvertes »).
// Usage : node academy/outils/emails-html.cjs [--vente]
const fs = require('fs');
const path = require('path');
const marketing = path.join(__dirname, '..', 'livraison', 'marketing');
const out = path.join(marketing, 'emails_html', 'brevo-ready');
const vente = process.argv.includes('--vente');
const emails = JSON.parse(fs.readFileSync(path.join(marketing, 'emails_source.json'), 'utf8').replace(/^﻿/, ''));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (/^[RSDE]\d\d\.html$/.test(f)) fs.unlinkSync(path.join(out, f));
for (const e of emails) {
  const paras = e.corps.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => {
    if (/^Bonjour \{\{ contact\.PRENOM/.test(p)) return '<p>{% if contact.PRENOM %}Bonjour {{ contact.PRENOM }},{% else %}Bonjour,{% endif %}</p>';
    return `<p>${esc(p).replace(/\n/g, '<br>')}</p>`;
  });
  const fin = vente ? e.fin_vente : e.fin_preouverture;
  const footer = esc(e.footer.replace(/\s*Se désabonner : \[lien individuel fourni par Brevo\]\.?$/, '')).trim();
  const html = `<!doctype html><html lang="fr-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(e.sujet)}</title></head><body style="margin:0;background:#edf3f1;font-family:Arial,sans-serif;color:#15363a"><div style="display:none;max-height:0;overflow:hidden">${esc(e.preheader)}</div><table role="presentation" width="100%" style="padding:24px 12px"><tr><td align="center"><table role="presentation" width="600" style="width:100%;max-width:600px;background:white;border-top:6px solid #c4f45c"><tr><td style="padding:32px;font-size:16px;line-height:1.65"><p style="color:#0a2431;font-size:13px;letter-spacing:2px;font-weight:bold">NEOMOOV ACADEMY</p><h1 style="font-size:26px;line-height:1.2;color:#0a2431">${esc(e.sujet)}</h1>${paras.join('')}<p style="font-size:15px;color:#405c68">${esc(fin)}</p><p style="margin:28px 0"><a href="${esc(e.url)}" style="display:inline-block;background:#c4f45c;color:#0a2431;padding:14px 20px;text-decoration:none;border-radius:5px;font-weight:bold">${esc(e.cta)}</a></p><hr style="border:0;border-top:1px solid #dfe9e5"><p style="font-size:12px;color:#53666b">${footer} <a href="{{ unsubscribe }}" style="color:#0a2431">Se désabonner</a></p></td></tr></table></td></tr></table></body></html>`;
  fs.writeFileSync(path.join(out, `${e.id}.html`), html);
}
console.log(`${emails.length} courriels HTML écrits dans ${path.relative(process.cwd(), out)} (version ${vente ? 'ventes ouvertes' : 'préouverture'})`);
