import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { downloadStatus, PdfDownloadError, PdfUnavailableError, type ProtectedPdf } from '@/features/invoices/logic';

/**
 * Ouverture d'un PDF protégé (facture, note de crédit) sur iPhone et Android : téléchargé avec le jeton d'accès dans le
 * cache de l'application (privé, remplacé au téléchargement suivant), puis présenté par la feuille de partage du
 * système : aperçu, enregistrement dans Fichiers ou Drive, envoi, impression. Version web : `invoice-pdf.web.ts`.
 */
export async function openProtectedPdf(pdf: ProtectedPdf): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new PdfUnavailableError();
  let file: File;
  try {
    file = await File.downloadFileAsync(pdf.url, new File(Paths.cache, pdf.fileName), { headers: pdf.headers, idempotent: true });
  } catch (error) {
    throw new PdfDownloadError(downloadStatus(error));
  }
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: pdf.title });
}
