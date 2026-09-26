import { PdfDownloadError, type ProtectedPdf } from '@/features/invoices/logic';

/**
 * Version web (démonstration, parcours de test) : téléchargement authentifié, puis enregistrement par le navigateur
 * (lien temporaire vers le fichier en mémoire, retiré après une minute).
 */
export async function openProtectedPdf(pdf: ProtectedPdf): Promise<void> {
  let response: Response;
  try {
    response = await fetch(pdf.url, { headers: pdf.headers });
  } catch {
    throw new PdfDownloadError(null);
  }
  if (!response.ok) throw new PdfDownloadError(response.status);
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = href;
  link.download = pdf.fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
