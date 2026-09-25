/** Libellés de repli des lignes d'un devis (les applications traduisent par `code` ; l'API donne le français canadien). */
import type { Language } from '@neomoov/domain';

const LABELS: Record<Language, Record<string, string>> = {
  fr: {
    base_fare: 'Prise en charge', distance: 'Distance', duration: 'Durée', minimum_fare: 'Course minimale', night: 'Supplément de nuit', airport: 'Supplément aéroport',
    child_seat: 'Siège enfant', bulky_luggage: 'Bagages volumineux', stops: 'Arrêts', flex: 'Offre Flex', priority: 'Option Priorité', favourite_driver: 'Chauffeur favori',
    flat_rate: 'Forfait', tolls: 'Péages', benchmark_alignment: 'Remise d\'alignement', wait_time: 'Attente', promotion: 'Promotion', service_fee: 'Frais de service',
    regulatory_fee: 'Redevance', gst: 'TPS', qst: 'TVQ', credits: 'Crédits',
  },
  en: {
    base_fare: 'Base fare', distance: 'Distance', duration: 'Time', minimum_fare: 'Minimum fare', night: 'Night surcharge', airport: 'Airport surcharge',
    child_seat: 'Child seat', bulky_luggage: 'Bulky luggage', stops: 'Stops', flex: 'Flex offer', priority: 'Priority option', favourite_driver: 'Favourite driver',
    flat_rate: 'Flat rate', tolls: 'Tolls', benchmark_alignment: 'Alignment discount', wait_time: 'Waiting time', promotion: 'Promotion', service_fee: 'Service fee',
    regulatory_fee: 'Regulatory fee', gst: 'GST', qst: 'QST', credits: 'Credits',
  },
};

export function lineLabel(code: string, language: Language = 'fr'): string {
  return LABELS[language]?.[code] ?? LABELS.fr[code] ?? code;
}
