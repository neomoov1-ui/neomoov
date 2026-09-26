/** Libellés des lignes de facture (français, document fiscal) ; les codes du devis gardent ceux de la tarification. */
import { lineLabel } from '../pricing/labels.js';

const INVOICE_LABELS: Record<string, string> = {
  wait_time: 'Attente sur place',
  fare_adjustment: 'Ajustement du tarif (prix convenu ou supplément retiré)',
  promotion: 'Promotion (compensée au chauffeur par Neomoov)',
  service_fee: 'Frais de service',
  regulatory_fee: 'Redevance gouvernementale',
  tolls: 'Péages',
  rounding: 'Arrondi',
  cancellation_fee: 'Frais d\'annulation',
  no_show_fee: 'Frais de non-présentation',
  transport: 'Transport',
};

export function invoiceLabel(code: string): string {
  return INVOICE_LABELS[code] ?? lineLabel(code, 'fr');
}
