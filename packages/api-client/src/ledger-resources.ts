/**
 * Registres de la redevance et des taxes, exports comptables et export de géolocalisation (prompt 09, tâches 7 et 8),
 * typés par les schémas de `@neomoov/domain`. Les fichiers (CSV, PDF) se téléchargent par leur chemin sous `/v1`, avec
 * le jeton : My Hub passe par sa passerelle (`/api/v1/...`), jamais par un lien public.
 */
import type {
  DriverTaxReport, GeolocationExportRunResult, GeolocationExportView, LedgerMonthView, LedgerSummaryView, LedgerType, RedevanceRemitInput, RedevanceRemitResult,
} from '@neomoov/domain';
import type { Transport } from './resources.js';

const id = (value: string) => encodeURIComponent(value);

export function ledgersResource(t: Transport) {
  return {
    /** Chemin du CSV d'un registre sur un mois (AAAA-MM) ou un trimestre (AAAA-Tn). */
    exportCsvPath: (type: LedgerType, period: string) => `/admin/ledgers/exports?type=${id(type)}&period=${id(period)}`,
    /** Mois des registres (24 derniers, ou ceux d'une période). */
    months: (period?: string) => t.get<LedgerMonthView[]>('/admin/ledgers/months', { query: { period } }),
    remitRedevance: (body: RedevanceRemitInput) => t.post<RedevanceRemitResult>('/admin/ledgers/redevance/remit', body),
    /** Demande le rapport de synthèse PDF (produit par le worker). */
    requestSummary: (type: LedgerType, period: string) => t.post<LedgerSummaryView>('/admin/ledgers/summaries', { type, period }),
    /** État du rapport ; 404 s'il n'a jamais été demandé. */
    summary: (type: LedgerType, period: string) => t.get<LedgerSummaryView>(`/admin/ledgers/summaries/${id(type)}/${id(period)}`),
    driverTaxReport: (driverId: string, quarter?: string) => t.get<DriverTaxReport>(`/admin/ledgers/drivers/${id(driverId)}/tax-report`, { query: { quarter } }),
    geolocationExports: () => t.get<GeolocationExportView[]>('/admin/geolocation-exports'),
    runGeolocationExport: (month: string) => t.post<GeolocationExportRunResult>('/admin/geolocation-exports', { month }, { timeoutMs: 60_000 }),
    /** Chemin du fichier archivé d'un export de géolocalisation. */
    geolocationFilePath: (exportId: string) => `/admin/geolocation-exports/${id(exportId)}/file`,
    /** Rapport trimestriel du chauffeur connecté (application chauffeur). */
    myTaxReport: (quarter?: string) => t.get<DriverTaxReport>('/driver/tax-report', { query: { quarter } }),
  };
}
