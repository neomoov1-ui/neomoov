/**
 * Affichage d'un document de chauffeur dans My Hub (revue du 2 octobre 2026, constat web 20) : une image s'affiche dans
 * `<img>` (aucun script n'y tourne), un PDF dans un cadre seulement si l'API l'annonce `application/pdf` ET que ses
 * premiers octets sont `%PDF-` ; tout autre contenu (type inconnu, faux PDF) est proposé au téléchargement, jamais
 * rendu. Le cadre n'a pas d'attribut `sandbox` : Chrome et Edge refusent alors d'afficher le PDF (essai du 3 octobre
 * 2026). Fonction pure, testée.
 */
export type DocumentKind = 'image' | 'pdf' | 'download';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export function documentKind(type: string, head: Uint8Array): DocumentKind {
  if (/^image\/(png|jpeg|webp|gif|heic|heif|avif)$/.test(type)) return 'image';
  if (type === 'application/pdf' && PDF_MAGIC.every((byte, i) => head[i] === byte)) return 'pdf';
  return 'download';
}
