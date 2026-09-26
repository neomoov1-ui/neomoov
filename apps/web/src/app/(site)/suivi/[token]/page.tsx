import type { Metadata } from 'next';
import { Tracking } from '@/components/tracking';

// Lien personnel : jamais indexé, jamais transmis en référent.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Tracking token={token} />;
}
