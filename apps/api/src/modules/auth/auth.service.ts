/**
 * Connexion des clients et des chauffeurs (téléphone et code SMS, Apple, Google), création du compte à la première
 * connexion, rafraîchissement et déconnexion. Un compte du personnel connecté par ces voies n'obtient jamais ses rôles
 * du personnel : ceux-ci exigent le mot de passe et le second facteur (StaffAuthService).
 */
import type { Language, OtpVerify, SocialLogin, TokensView, UserRole } from '@neomoov/domain';
import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import { SettingsService } from '../../common/settings.service.js';
import { isStaffRole, type RequestContext, type UserActor } from './actor.js';
import { AuditService } from '../audit/audit.service.js';
import { OtpService } from './otp.service.js';
import { SocialService, type SocialIdentity, type SocialProvider } from './social.service.js';
import { TokensService } from './tokens.service.js';
import { UsersService, type UserRow } from '../users/users.service.js';

export type SocialLoginResult = TokensView | { status: 'phone_required'; linkToken: string; email: string | null };

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly otp: OtpService,
    private readonly social: SocialService,
    private readonly tokens: TokensService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly store: RateLimitService,
  ) {}

  async requestOtp(phone: string, ctx: RequestContext, language?: Language) {
    return this.otp.request(phone, ctx.ip, language ?? ctx.language);
  }

  /** Vérifie le code, crée le compte s'il n'existe pas (conditions acceptées), lie Apple ou Google si un jeton de liaison est fourni. */
  async verifyOtp(input: OtpVerify, ctx: RequestContext): Promise<TokensView> {
    // Le jeton de liaison est vérifié avant de consommer le code SMS : un jeton périmé ne coûte pas un code.
    const link = input.linkToken ? await this.readLinkToken(input.linkToken) : null;
    await this.otp.verify(input.phone, input.code);
    if (link) {
      const ttl = await this.settings.number('auth.link_token_ttl_seconds', 600);
      if (!(await this.store.claimOnce(`transient:${link.jti}`, ttl + 60))) throw AppError.unauthorized('INVALID_TRANSIENT_TOKEN', 'Jeton de liaison déjà utilisé : recommencez la connexion');
    }
    let user = await this.users.findByPhone(input.phone);
    let created = false;
    if (user && (user.status === 'deleted' || user.deletedAt)) {
      // Suppression demandée mais pas encore traitée par le worker : le numéro est libéré tout de suite (même opération que la tâche).
      await this.users.releasePhone(user.id);
      user = null;
    }
    const linkEmail = link ? await this.usableEmail(link) : null;
    if (!user) {
      const currentVersion = await this.users.currentPrivacyPolicyVersion();
      if (input.acceptTerms !== true) throw new AppError('TERMS_NOT_ACCEPTED', 'Les conditions d\'utilisation doivent être acceptées pour créer un compte', 400);
      if (input.privacyPolicyVersion !== currentVersion) {
        throw new AppError('PRIVACY_POLICY_VERSION_OUTDATED', 'La version en vigueur de la politique de confidentialité doit être acceptée', 400, { currentVersion });
      }
      user = await this.users.createClientAccount({
        phone: input.phone,
        language: input.language ?? ctx.language,
        privacyPolicyVersion: currentVersion,
        email: linkEmail,
        appleId: link?.provider === 'apple' ? link.subject : null,
        googleId: link?.provider === 'google' ? link.subject : null,
      });
      created = true;
      this.audit.record({ action: 'auth.account_created', entity: 'users', entityId: user.id, after: { phone: user.phone, language: user.language, privacyPolicyVersion: currentVersion } });
    } else {
      this.users.requireUsable(user);
      if (link) {
        const alreadyLinked = await this.users.findBySocialId(link.provider, link.subject);
        if (alreadyLinked && alreadyLinked.id !== user.id) throw AppError.conflict('SOCIAL_ID_ALREADY_LINKED', `Ce compte ${link.provider} est déjà lié à un autre utilisateur`);
        await this.users.linkSocialId(user.id, link.provider, link.subject, linkEmail);
        this.audit.record({ action: `auth.${link.provider}_linked`, entity: 'users', entityId: user.id });
        user = (await this.users.findById(user.id)) ?? user;
      }
    }
    const amr = link ? ['otp', link.provider] : ['otp'];
    return this.openSession(user, { device: input.device ?? null, amr, ctx, created });
  }

  /** Courriel remis par Apple ou Google : repris seulement s'il est vérifié par le fournisseur et libre ; sinon l'utilisateur le saisira. */
  private async usableEmail(identity: SocialIdentity): Promise<string | null> {
    if (!identity.email || !identity.emailVerified) return null;
    return (await this.users.findByEmail(identity.email)) ? null : identity.email;
  }

  /** Apple ou Google : compte lié → session ; sinon jeton de liaison, le téléphone doit être vérifié par code SMS. */
  async socialLogin(provider: SocialProvider, input: SocialLogin, ctx: RequestContext): Promise<SocialLoginResult> {
    const identity = await this.social.verify(provider, input.identityToken, input.nonce);
    const linked = await this.users.findBySocialId(provider, identity.subject);
    if (linked) {
      this.users.requireUsable(linked);
      return this.openSession(linked, { device: input.device ?? null, amr: [provider], ctx, created: false });
    }
    const ttl = await this.settings.number('auth.link_token_ttl_seconds', 600);
    const linkToken = await this.tokens.issueTransientToken('link', identity.subject, { provider, email: identity.email, emailVerified: identity.emailVerified }, ttl);
    return { status: 'phone_required', linkToken, email: identity.email };
  }

  private async readLinkToken(token: string): Promise<SocialIdentity & { jti: string }> {
    const { subject, jti, data } = await this.tokens.verifyTransientToken('link', token);
    const provider = data['provider'];
    if (provider !== 'apple' && provider !== 'google') throw AppError.unauthorized('INVALID_TRANSIENT_TOKEN', 'Jeton de liaison invalide');
    return { provider, subject, jti, email: typeof data['email'] === 'string' ? data['email'] : null, emailVerified: data['emailVerified'] === true };
  }

  async refresh(refreshToken: string, ctx: RequestContext): Promise<TokensView> {
    // Le compte est vérifié avant la rotation : un compte bloqué ou supprimé ne laisse pas de nouvelle session derrière lui.
    const existing = await this.tokens.findSessionByRefreshToken(refreshToken);
    if (existing) this.users.requireUsable(await this.users.findById(existing.userId));
    const rotated = await this.tokens.rotateSession(refreshToken, ctx);
    const user = this.users.requireUsable(await this.users.findById(rotated.userId));
    const roles = await this.users.rolesOf(user.id);
    // Les rôles du personnel n'existent que dans une session ouverte par mot de passe et second facteur (`amr` contient
    // `mfa`, conservé à la rotation) ; une session ouverte par code SMS reste sans rôle du personnel.
    const grantedRoles = rotated.amr.includes('mfa') ? roles : roles.filter((r) => !isStaffRole(r));
    const access = await this.tokens.issueAccessToken({ userId: user.id, sessionId: rotated.session.sessionId, primaryRole: user.primaryRole, roles: grantedRoles, amr: rotated.amr });
    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: rotated.session.refreshToken,
      created: false,
      user: await this.users.meViewOf(user, grantedRoles),
    };
  }

  async logout(actor: UserActor, input: { refreshToken?: string | undefined; allDevices: boolean }): Promise<void> {
    if (input.allDevices) {
      await this.tokens.revokeAllForUser(actor.userId);
    } else {
      await this.tokens.revokeSession(actor.sessionId);
      if (input.refreshToken) await this.tokens.revokeByRefreshToken(input.refreshToken, actor.userId);
    }
    this.audit.record({ action: input.allDevices ? 'auth.logout_all' : 'auth.logout', entity: 'sessions', entityId: actor.sessionId });
  }

  private async openSession(user: UserRow, options: { device: OtpVerify['device'] | null; amr: string[]; ctx: RequestContext; created: boolean }): Promise<TokensView> {
    const device = options.device ? await this.users.upsertDevice(user.id, options.device) : null;
    const roles = (await this.users.rolesOf(user.id)).filter((r: UserRole) => !isStaffRole(r));
    const session = await this.tokens.createSession({ userId: user.id, deviceId: device?.id ?? null, ip: options.ctx.ip, userAgent: options.ctx.userAgent, amr: options.amr });
    const access = await this.tokens.issueAccessToken({ userId: user.id, sessionId: session.sessionId, primaryRole: user.primaryRole, roles, amr: options.amr });
    this.audit.record({ action: 'auth.login', entity: 'sessions', entityId: session.sessionId, after: { amr: options.amr, deviceId: device?.id ?? null } });
    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: session.refreshToken,
      created: options.created,
      user: await this.users.meViewOf(user, roles),
    };
  }
}
