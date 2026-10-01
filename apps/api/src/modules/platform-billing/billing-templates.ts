/**
 * Gabarits des avis de facturation de la plateforme (étape 25), en français (fr-CA) et en anglais, envoyés par courriel
 * au propriétaire du compte de l'organisation : facture émise (PDF joint), rappel, lecture seule, suspension,
 * réactivation. Fonctions pures ; ajoutés aux gabarits des notifications (`templates.ts`).
 */
type Data = Record<string, unknown>;
type Language = 'fr' | 'en';
type Text = (d: Data, l: Language) => string;

export interface BillingTemplate {
  fr: { title: Text; body: Text };
  en: { title: Text; body: Text };
}

const TIME_ZONE = 'America/Toronto';
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

function money(cents: unknown, l: Language): string {
  return new Intl.NumberFormat(l === 'en' ? 'en-CA' : 'fr-CA', { style: 'currency', currency: 'CAD' }).format((typeof cents === 'number' ? cents : 0) / 100);
}

function day(iso: unknown, l: Language): string {
  if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) return '';
  return new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { timeZone: TIME_ZONE, dateStyle: 'long' }).format(new Date(iso));
}

const pay = (d: Data, l: Language) => (str(d['hostedInvoiceUrl']) ? (l === 'en' ? ` Pay online: ${str(d['hostedInvoiceUrl'])}` : ` Payer en ligne : ${str(d['hostedInvoiceUrl'])}`) : '');
const who = (d: Data) => (str(d['organizationName']) ? ` (${str(d['organizationName'])})` : '');

export const BILLING_TEMPLATES: Record<string, BillingTemplate> = {
  'billing.invoice_issued': {
    fr: {
      title: (d) => `Facture ${str(d['number'])} de la plateforme Neomoov`,
      body: (d, l) => `Votre facture ${str(d['number'])}${who(d)} de ${money(d['totalCents'], l)}, taxes comprises, pour la formule ${str(d['planName'])} est émise ; elle est jointe à ce courriel et payable au plus tard le ${day(d['dueAt'], l)}. Avec une carte enregistrée, le prélèvement est automatique.${pay(d, l)}`,
    },
    en: {
      title: (d) => `Neomoov platform invoice ${str(d['number'])}`,
      body: (d, l) => `Your invoice ${str(d['number'])}${who(d)} for ${money(d['totalCents'], l)}, taxes included, for the ${str(d['planName'])} plan has been issued; it is attached to this email and due by ${day(d['dueAt'], l)}. With a saved card, payment is automatic.${pay(d, l)}`,
    },
  },
  'billing.reminder': {
    fr: {
      title: (d) => `Rappel : facture ${str(d['number'])} impayée`,
      body: (d, l) => `Rappel ${str(d['reminder'])} : la facture ${str(d['number'])}${who(d)} de ${money(d['totalCents'], l)} est échue depuis ${str(d['daysOverdue'])} jours. Sans règlement, votre espace passera en lecture seule le ${day(d['readOnlyAt'], l)}.${pay(d, l)}`,
    },
    en: {
      title: (d) => `Reminder: invoice ${str(d['number'])} unpaid`,
      body: (d, l) => `Reminder ${str(d['reminder'])}: invoice ${str(d['number'])}${who(d)} for ${money(d['totalCents'], l)} has been overdue for ${str(d['daysOverdue'])} days. Without payment, your workspace will become read-only on ${day(d['readOnlyAt'], l)}.${pay(d, l)}`,
    },
  },
  'billing.read_only': {
    fr: {
      title: () => 'Votre espace Neomoov est en lecture seule',
      body: (d, l) => `Faute de règlement de la facture ${str(d['number'])} (${money(d['totalCents'], l)}), votre organisation${who(d)} est en lecture seule : vos données restent consultables et exportables, mais plus aucune modification n'est possible. Sans règlement, elle sera suspendue le ${day(d['suspendAt'], l)} ; aucune course en cours n'est interrompue.${pay(d, l)}`,
    },
    en: {
      title: () => 'Your Neomoov workspace is read-only',
      body: (d, l) => `Because invoice ${str(d['number'])} (${money(d['totalCents'], l)}) is unpaid, your organization${who(d)} is now read-only: your data remains viewable and exportable, but no changes can be made. Without payment, it will be suspended on ${day(d['suspendAt'], l)}; no ride in progress is interrupted.${pay(d, l)}`,
    },
  },
  'billing.suspended': {
    fr: {
      title: () => 'Votre espace Neomoov est suspendu',
      body: (d, l) => `Votre organisation${who(d)} est suspendue faute de règlement de la facture ${str(d['number'])} (${money(d['totalCents'], l)}). Réglez-la pour retrouver l'accès : la réactivation est immédiate.${pay(d, l)}`,
    },
    en: {
      title: () => 'Your Neomoov workspace is suspended',
      body: (d, l) => `Your organization${who(d)} is suspended because invoice ${str(d['number'])} (${money(d['totalCents'], l)}) is unpaid. Pay it to restore access: reactivation is immediate.${pay(d, l)}`,
    },
  },
  'billing.reactivated': {
    fr: {
      title: () => 'Votre espace Neomoov est réactivé',
      body: (d) => `Merci : votre règlement est reçu. Votre organisation${who(d)} retrouve l'accès complet à la plateforme.`,
    },
    en: {
      title: () => 'Your Neomoov workspace is reactivated',
      body: (d) => `Thank you: your payment has been received. Your organization${who(d)} has full access to the platform again.`,
    },
  },
};
