import Link from 'next/link';
import type { ComponentProps } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const styles: Record<Variant, string> = {
  primary: 'bg-brand-blue text-white hover:bg-brand-blue-dark',
  secondary: 'bg-brand-green text-brand-night hover:bg-brand-blue hover:text-white',
  ghost: 'bg-transparent text-brand-blue hover:bg-brand-tint',
};

const base = 'inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold uppercase tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:opacity-50';

/** Bouton Neomoov (style shadcn/ui simplifié) ; avec `href`, rend un lien. */
export function Button({ variant = 'primary', href, className = '', ...props }: ComponentProps<'button'> & { variant?: Variant; href?: string }) {
  const cls = `${base} ${styles[variant]} ${className}`;
  if (href) return <Link href={href} className={cls}>{props.children}</Link>;
  return <button type="button" className={cls} {...props} />;
}
