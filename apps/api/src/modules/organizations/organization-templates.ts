/**
 * Gabarits des avis des organisations clientes (finalisation du 3 octobre 2026), en français (fr-CA) et en anglais :
 * alerte au propriétaire du compte quand une permission sensible est utilisée (amendement v1.2, section 3.2) et relevé
 * quotidien des échéances au gestionnaire de flotte (étape 23). Fonctions pures ; ajoutés aux gabarits des notifications
 * (`templates.ts`), comme ceux de la facturation de la plateforme.
 */
type Data = Record<string, unknown>;
type Language = 'fr' | 'en';
type Text = (d: Data, l: Language) => string;

export interface OrganizationTemplate {
  fr: { title: Text; body: Text };
  en: { title: Text; body: Text };
}

const TIME_ZONE = 'America/Toronto';
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const list = (v: unknown): string => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').join(', ') : '');

function when(iso: unknown, l: Language): string {
  if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) return '';
  return new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { timeZone: TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

const org = (d: Data, fallback: string) => str(d['organizationName']) || fallback;

export const ORGANIZATION_TEMPLATES: Record<string, OrganizationTemplate> = {
  'organization.sensitive_permission_used': {
    fr: {
      title: (d) => `Action sensible dans ${org(d, 'votre organisation')}`,
      body: (d, l) => `${str(d['actorName']) || 'Un membre'} a utilisé une permission sensible dans ${org(d, 'votre organisation')} le ${when(d['at'], l)} : ${list(d['labels']) || list(d['permissions'])}. Si ce n'était pas prévu, suspendez ce membre dans My Hub, menu Membres, et consultez le journal.`,
    },
    en: {
      title: (d) => `Sensitive action in ${org(d, 'your organization')}`,
      body: (d, l) => `${str(d['actorName']) || 'A member'} used a sensitive permission in ${org(d, 'your organization')} on ${when(d['at'], l)}: ${list(d['permissions'])}. If this was not expected, suspend this member in My Hub, Members menu, and review the log.`,
    },
  },
  'fleet.compliance_digest': {
    fr: {
      title: (d) => `Échéances de la flotte ${org(d, '')}`.trim(),
      body: (d) => `Dans les ${str(d['days'])} prochains jours : ${str(d['documents'])} document(s) de chauffeur, ${str(d['inspections'])} vérification(s) ou inspection(s) de véhicule${Number(d['overdue'] ?? 0) > 0 ? `, dont ${str(d['overdue'])} déjà en retard` : ''}${Number(d['maintenance'] ?? 0) > 0 ? ` ; ${str(d['maintenance'])} entretien(s) à prévoir` : ''}. Détail dans My Hub, Flotte, Échéances.`,
    },
    en: {
      title: (d) => `Fleet deadlines ${org(d, '')}`.trim(),
      body: (d) => `In the next ${str(d['days'])} days: ${str(d['documents'])} driver document(s), ${str(d['inspections'])} vehicle check(s) or inspection(s)${Number(d['overdue'] ?? 0) > 0 ? `, ${str(d['overdue'])} already overdue` : ''}${Number(d['maintenance'] ?? 0) > 0 ? `; ${str(d['maintenance'])} maintenance item(s) to plan` : ''}. Details in My Hub, Fleet, Deadlines.`,
    },
  },
};
