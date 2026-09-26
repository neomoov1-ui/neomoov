import type { Metadata } from 'next';
import { InvoiceVerificationView } from '@/components/invoice-verification';

// Lien du code QR d'une facture : jamais indexé, jamais transmis en référent.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function InvoiceVerificationPage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const { t } = await searchParams;
  return <InvoiceVerificationView token={typeof t === 'string' ? t : null} />;
}
