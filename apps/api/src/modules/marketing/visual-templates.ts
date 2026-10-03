/**
 * Gabarits de mise en page des visuels par réseau (chantier « Réseaux sociaux » du 3 octobre 2026) : six gabarits
 * (bandeau, cadre, diagonale, carte, plein cadre, partage) en HTML autonome, à la taille exacte du réseau, rendus en PNG
 * par le navigateur de l'image Docker (`VisualsService.render`). La photo est toujours une photo réelle de la médiathèque
 * du site (règle D46), créditée ; sans photo, un fond de marque. Fonction pure : même entrée, même HTML.
 */
import type { ContentLanguage, VisualSize, VisualVariant } from '@neomoov/domain';

export interface VariantPhoto {
  url: string;
  alt: string | null;
}

export interface VariantHtmlInput {
  size: VisualSize;
  language: ContentLanguage;
  variant: VisualVariant;
  photo: VariantPhoto | null;
  /** Nom du réseau, en petit (lisibilité de l'aperçu dans My Hub). */
  spaceName: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NIGHT = '#10171f';
const DEEP = '#0a2431';
const TEAL = '#163541';
const POSITION: Record<VisualVariant['crop'], string> = { center: 'center', top: 'center top', bottom: 'center bottom', left: 'left center', right: 'right center' };

/** Couleur du texte posé sur l'accent : sombre sur les accents clairs, blanc sur le bleu. */
function onAccent(accent: string): string {
  const n = parseInt(accent.replace('#', ''), 16);
  const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance > 0.6 ? NIGHT : '#ffffff';
}

/** HTML complet d'un visuel de publication, à la taille du réseau. */
export function variantHtml(input: VariantHtmlInput): string {
  const { size, variant, photo, language } = input;
  const { width, height } = size;
  const portrait = height > width;
  const square = Math.abs(width - height) < 40;
  const unit = Math.min(width, height) / 1080;
  const px = (n: number) => `${Math.round(n * unit)}px`;
  const accent = variant.accent;
  const ink = onAccent(accent);
  const headlineSize = portrait ? 96 : square ? 84 : width >= 1500 ? 78 : 70;
  const justify = variant.titlePosition === 'top' ? 'flex-start' : variant.titlePosition === 'center' ? 'center' : 'flex-end';
  const photoLayer = photo
    ? `<div class="photo" style="background-image:url(&quot;${esc(photo.url)}&quot;);background-position:${POSITION[variant.crop]};transform:scale(${(variant.zoom / 100).toFixed(2)})"></div>`
    : `<div class="photo" style="background:linear-gradient(${variant.template === 'diagonal' ? 160 : 135}deg,${DEEP} 0%,${NIGHT} 55%,${TEAL} 100%)"></div>`;
  const credit = photo?.alt ? `<div class="credit">${esc(photo.alt)}</div>` : '';
  const brand = `<div class="brand">neomoov<span>MONTRÉAL</span></div>`;
  const tagline = `<div class="tag">${esc(variant.tagline)}</div>`;
  const headline = `<h1>${esc(variant.imageText)}</h1>`;
  const footer = `<div class="foot">neomoov.net</div>`;

  let layout: string;
  switch (variant.template) {
    case 'banner':
      layout = `<div class="fill">${photoLayer}</div><div class="stack" style="justify-content:${justify}"><div class="band">${tagline}${headline}</div></div>`;
      break;
    case 'frame':
      layout = `<div class="fill" style="background:${NIGHT}"></div><div class="framed">${photoLayer}</div><div class="stack" style="justify-content:${justify}"><div class="plain">${tagline}${headline}</div></div>`;
      break;
    case 'diagonal':
      layout = `<div class="fill" style="background:${DEEP}"></div><div class="fill diag">${photoLayer}</div><div class="stripe"></div><div class="stack" style="justify-content:${justify}"><div class="plain shade">${tagline}${headline}</div></div>`;
      break;
    case 'card':
      layout = `<div class="fill">${photoLayer}</div><div class="stack" style="justify-content:${justify}"><div class="card">${tagline}${headline}</div></div>`;
      break;
    case 'fullbleed':
      layout = `<div class="fill">${photoLayer}<div class="veil"></div></div><div class="stack" style="justify-content:${justify}"><div class="plain">${tagline}${headline}<div class="rule"></div></div></div>`;
      break;
    default:
      // split : moitié photo, moitié couleur (en hauteur sur un format vertical, en largeur sinon).
      layout = `<div class="fill" style="background:${variant.titlePosition === 'center' ? TEAL : DEEP}"></div><div class="half">${photoLayer}</div><div class="other"><div class="plain">${tagline}${headline}</div></div>`;
  }

  return `<!doctype html><html lang="${language === 'en' ? 'en-CA' : 'fr-CA'}"><head><meta charset="utf-8"><title>${esc(variant.imageText)}</title><style>
*{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}body{position:relative;font-family:"Segoe UI",Arial,sans-serif;color:#fff;background:${NIGHT}}
.fill{position:absolute;inset:0;overflow:hidden}.photo{position:absolute;inset:0;background-size:cover;background-repeat:no-repeat}
.stack{position:absolute;inset:${px(150)} ${px(64)} ${px(120)};display:flex;flex-direction:column}
h1{margin:0;font-size:${px(headlineSize)};line-height:1.08;letter-spacing:-1px;font-weight:800}
.tag{display:inline-block;font-size:${px(26)};letter-spacing:3px;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:${px(18)}}
.band{background:rgba(16,23,31,.86);padding:${px(36)} ${px(44)};border-left:${px(14)} solid ${accent}}
.plain{max-width:100%}.shade h1{text-shadow:0 2px 14px rgba(0,0,0,.5)}
.framed{position:absolute;overflow:hidden;border:${px(12)} solid ${accent};${portrait ? `left:${px(64)};right:${px(64)};top:${px(380)};bottom:${px(380)}` : `top:${px(64)};bottom:${px(64)};right:${px(64)};width:48%`}}
.framed + .stack{${portrait ? '' : `right:calc(48% + ${px(110)})`}}
.diag{clip-path:polygon(${portrait ? '0 0,100% 0,100% 58%,0 76%' : '38% 0,100% 0,100% 100%,62% 100%'})}
.stripe{position:absolute;background:${accent};${portrait ? `left:0;right:0;top:66%;height:${px(18)};transform:skewY(-8deg)` : `top:0;bottom:0;left:49%;width:${px(18)};transform:skewX(-14deg)`}}
.card{background:#ffffff;color:${NIGHT};border-radius:${px(28)};padding:${px(44)};box-shadow:0 ${px(20)} ${px(60)} rgba(0,0,0,.35);max-width:${portrait ? '100%' : '70%'}}.card .tag{background:${accent};color:${ink};padding:${px(6)} ${px(14)};border-radius:${px(8)}}
.veil{position:absolute;inset:0;background:linear-gradient(${variant.titlePosition === 'top' ? '0deg' : '180deg'},rgba(16,23,31,0) 20%,rgba(16,23,31,.88) 100%)}
.rule{margin-top:${px(26)};width:${px(180)};height:${px(12)};background:${accent};border-radius:${px(6)}}
.half{position:absolute;overflow:hidden;${portrait ? 'left:0;right:0;top:0;height:55%' : 'top:0;bottom:0;left:0;width:52%'}}
.other{position:absolute;display:flex;flex-direction:column;justify-content:center;padding:${px(64)};${portrait ? 'left:0;right:0;bottom:0;height:45%' : 'top:0;bottom:0;right:0;width:48%'};border-${portrait ? 'top' : 'left'}:${px(14)} solid ${accent}}
.brand{position:absolute;top:${px(48)};left:${px(64)};font-size:${px(44)};font-weight:800;letter-spacing:-1px;text-shadow:0 1px 10px rgba(0,0,0,.4)}.brand span{font-size:${px(16)};letter-spacing:5px;margin-left:${px(12)};font-weight:700;color:${accent}}
.foot{position:absolute;bottom:${px(40)};left:${px(64)};font-size:${px(26)};font-weight:600;color:#e6edf2;text-shadow:0 1px 8px rgba(0,0,0,.5)}
.net{position:absolute;top:${px(56)};right:${px(64)};font-size:${px(18)};letter-spacing:2px;text-transform:uppercase;color:#d6e0e6}
.credit{position:absolute;bottom:${px(12)};right:${px(24)};font-size:${px(14)};color:#c7d3da;max-width:60%;text-align:right}
</style></head><body data-template="${variant.template}" data-size="${width}x${height}">${layout}${brand}<div class="net">${esc(input.spaceName)}</div>${footer}${credit}</body></html>`;
}
