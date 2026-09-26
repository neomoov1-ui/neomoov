/**
 * Côté chauffeur (5.6, prompt 07) : compte Stripe Connect Express pour les versements du vendredi (vérification
 * d'identité par Stripe) et méthode de prélèvement pour les relevés négatifs (étape 9). Le service des chauffeurs
 * (écran « Versements » de l'application) délègue ici.
 */
import { schema } from '@neomoov/db';
import type { ConnectStatus, SetupIntentResponse } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { PaymentsService } from './payments.service.js';

@Injectable()
export class DriverPaymentsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async driverOf(userId: string) {
    const [driver] = await this.db.select().from(schema.drivers).where(eq(schema.drivers.userId, userId)).limit(1);
    if (!driver) throw AppError.notFound('DRIVER_NOT_FOUND', 'Profil chauffeur introuvable : faites d\'abord votre candidature');
    return driver;
  }

  /** Lien d'inscription Stripe (webview de l'application) ; le compte Express est créé au premier appel. */
  async onboardingLink(userId: string): Promise<{ url: string; expiresAt: string; simulated: boolean }> {
    const driver = await this.driverOf(userId);
    let accountRef = driver.stripeConnectAccountId;
    if (!accountRef) {
      const [user] = await this.db.select({ email: schema.users.email, phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      accountRef = (await this.provider.createConnectAccount({ externalId: driver.id, ...(user?.email ? { email: user.email } : {}), ...(user?.phone ? { phone: user.phone } : {}) })).accountRef;
      await this.db.update(schema.drivers).set({ stripeConnectAccountId: accountRef }).where(eq(schema.drivers.id, driver.id));
    }
    const [returnUrl, refreshUrl] = await Promise.all([
      this.settings.string('payout.return_url', 'https://neomoov.net/chauffeurs/versements/retour'),
      this.settings.string('payout.refresh_url', 'https://neomoov.net/chauffeurs/versements/reprendre'),
    ]);
    const link = await this.provider.createConnectOnboardingLink({ accountRef, returnUrl, refreshUrl });
    return { url: link.url, expiresAt: link.expiresAt.toISOString(), simulated: this.provider.name === 'mock' };
  }

  /** État du compte (relu chez Stripe tant que l'inscription n'est pas terminée ; ensuite par le webhook `account.updated`). */
  async status(userId: string): Promise<ConnectStatus> {
    let driver = await this.driverOf(userId);
    let payoutsEnabled = driver.stripeConnectOnboarded;
    if (driver.stripeConnectAccountId) {
      const remote = await this.provider.connectAccountStatus(driver.stripeConnectAccountId);
      payoutsEnabled = remote.payoutsEnabled;
      if (remote.onboarded !== driver.stripeConnectOnboarded) {
        await this.db.update(schema.drivers).set({ stripeConnectOnboarded: remote.onboarded }).where(eq(schema.drivers.id, driver.id));
        driver = { ...driver, stripeConnectOnboarded: remote.onboarded };
      }
    }
    return {
      linked: Boolean(driver.stripeConnectAccountId),
      onboarded: driver.stripeConnectOnboarded,
      payoutsEnabled,
      debitMethod: driver.stripeDebitPaymentMethodId && driver.stripeDebitCardLast4 ? { brand: driver.stripeDebitCardBrand ?? 'card', last4: driver.stripeDebitCardLast4 } : null,
      provider: this.provider.name,
    };
  }

  async debitSetupIntent(userId: string): Promise<SetupIntentResponse> {
    await this.driverOf(userId);
    return this.payments.newSetupIntent(userId);
  }

  /** Méthode de prélèvement : carte relue chez Stripe à partir du SetupIntent confirmé par l'application. */
  async confirmDebitMethod(userId: string, setupIntentId: string): Promise<ConnectStatus> {
    const driver = await this.driverOf(userId);
    const card = await this.payments.confirmedCardOf(userId, setupIntentId);
    await this.db.update(schema.drivers).set({ stripeDebitPaymentMethodId: card.ref, stripeDebitCardBrand: card.brand, stripeDebitCardLast4: card.last4 }).where(eq(schema.drivers.id, driver.id));
    return this.status(userId);
  }
}
