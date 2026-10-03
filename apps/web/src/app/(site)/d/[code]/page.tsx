import { isJoinCode, normalizeJoinCode } from '@neomoov/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { resources } from '@/lib/i18n-resources';
import { currentLanguage } from '@/lib/language.server';
import { brandForCode } from '@/lib/server/brand';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Lien de rattachement réservé aux chauffeurs `/d/<code>` (revue du 2 octobre 2026, constat mobile 12), repli quand
 * l'application Neomoov Chauffeur n'est pas installée : marque de l'organisation (nom, couleurs, logo) et marche à suivre
 * dans l'application, à l'image de `/c/<code>` pour les clients. Le lien universel ouvre l'application quand elle l'est.
 */
export default async function DriverJoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const texts = resources[await currentLanguage()].translation.driverJoinCode;
  const normalized = normalizeJoinCode(decodeURIComponent(code));
  const found = isJoinCode(normalized) ? await brandForCode(normalized) : null;
  if (!found) {
    return <div className="mx-auto max-w-xl py-10"><p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4">{texts.notFound}</p></div>;
  }
  const { brand } = found;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-8">
      <section className="flex items-center gap-4 rounded-lg border p-4" style={{ background: brand.colors.background, borderColor: brand.colors.primary, color: brand.colors.text }}>
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt={brand.displayName} className="h-12 w-auto" />
        ) : (
          <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-md text-xl font-bold text-white" style={{ background: brand.colors.primary }}>{brand.displayName.slice(0, 1).toUpperCase()}</span>
        )}
        <div>
          <h1 className="text-2xl">{texts.title.replace('{{name}}', found.organizationName)}</h1>
          {brand.tagline ? <p className="text-sm">{brand.tagline}</p> : null}
        </div>
      </section>
      <p>{texts.app}</p>
      <p className="text-sm">{texts.code} : <strong className="font-mono text-lg tracking-widest">{found.joinCode}</strong></p>
      <p className="text-sm text-slate-700">{texts.fleet}</p>
      <div><Link href="/chauffeurs" className="inline-flex rounded-md bg-brand-blue-dark px-3 py-2 text-sm font-semibold text-white">{texts.become}</Link></div>
    </div>
  );
}
