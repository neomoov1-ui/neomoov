/**
 * Connexion du personnel en deux facteurs, relayée : les jetons renvoyés par l'API sont posés en témoins `httpOnly` et
 * retirés de la réponse ; le navigateur ne reçoit que le profil (et les codes de secours à la première inscription).
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { API_URL, forwardHeaders, setSession } from '@/lib/server/gateway';

export const dynamic = 'force-dynamic';

const STEPS: Record<string, string> = { login: 'login', enroll: 'mfa/enroll', confirm: 'mfa/confirm', verify: 'mfa/verify', backup: 'mfa/backup' };

export async function POST(req: NextRequest, context: { params: Promise<{ step: string }> }): Promise<NextResponse> {
  const { step } = await context.params;
  const target = STEPS[step];
  if (!target) return NextResponse.json({ code: 'NOT_FOUND', message: 'Étape inconnue' }, { status: 404 });
  const upstream = await fetch(`${API_URL}/v1/auth/staff/${target}`, { method: 'POST', headers: forwardHeaders(req, { 'content-type': 'application/json' }), body: await req.text(), cache: 'no-store' });
  const payload = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  if (!upstream.ok || typeof payload['accessToken'] !== 'string') return NextResponse.json(payload, { status: upstream.status });
  const { accessToken, refreshToken, expiresIn, user, backupCodes } = payload as { accessToken: string; refreshToken: string; expiresIn?: number; user: { id: string; firstName: string | null; lastName: string | null; email: string | null; roles: string[] }; backupCodes?: string[] };
  const res = NextResponse.json({ user: { id: user.id, firstName: user.firstName, lastName: user.lastName, roles: user.roles }, ...(backupCodes ? { backupCodes } : {}) });
  setSession(res, { accessToken, refreshToken, ...(expiresIn ? { expiresIn } : {}), user });
  return res;
}
