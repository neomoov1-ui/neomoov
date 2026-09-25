import type {
  FlatRate, PeakWindow, PricingErrorCode, PricingRules, Promotion, Quote, QuoteInput, QuoteLine, SurchargeRules,
} from './types.js';

export class PricingError extends Error {
  constructor(public readonly code: PricingErrorCode, message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

/** Multiplie puis divise des entiers non négatifs, avec arrondi au plus proche (demi vers le haut). */
export function mulDivRound(value: number, multiplier: number, divisor: number): number {
  return Math.floor((value * multiplier + divisor / 2) / divisor);
}

/** Heure, minute et jour de la semaine (0 pour dimanche) dans le fuseau donné. */
export function localTimeParts(date: Date, timeZone: string): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)!.value;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday, hour: Number(get('hour')), minute: Number(get('minute')) };
}

/** Nuit : de `nightStartHour` incluse à `nightEndHour` exclue, en heure locale, en passant par minuit. */
export function isNightTime(date: Date, surcharges: SurchargeRules, timeZone: string): boolean {
  const { hour } = localTimeParts(date, timeZone);
  return hour >= surcharges.nightStartHour || hour < surcharges.nightEndHour;
}

/** Heure de pointe : sert seulement à refuser l'Offre Flex. Il n'existe aucun multiplicateur de pointe. */
export function isPeakHours(date: Date, windows: PeakWindow[], timeZone: string): boolean {
  const { weekday, hour, minute } = localTimeParts(date, timeZone);
  const now = hour * 60 + minute;
  return windows.some((w) => w.days.includes(weekday) && now >= w.startMinute && now < w.endMinute);
}

/** Forfait applicable entre deux zones, dans le sens défini ou dans les deux sens. */
export function matchFlatRate(
  flatRates: FlatRate[], originZone: string | null | undefined, destinationZone: string | null | undefined,
): FlatRate | null {
  if (!originZone || !destinationZone) return null;
  return flatRates.find((f) =>
    (f.originZone === originZone && f.destinationZone === destinationZone)
    || (f.bidirectional && f.originZone === destinationZone && f.destinationZone === originZone)) ?? null;
}

/** Suppléments fixes applicables, dans un ordre stable. */
export function applySurcharges(input: QuoteInput, rules: PricingRules): QuoteLine[] {
  const s = rules.surcharges;
  const o = input.options ?? {};
  const lines: QuoteLine[] = [];
  const push = (code: string, amountCents: number): void => { lines.push({ kind: 'surcharge', code, amountCents }); };
  if (isNightTime(input.pickupAt, s, rules.timeZone)) push('night', s.nightCents);
  if (input.airport) push('airport', s.airportCents);
  if (o.childSeat) push('child_seat', s.childSeatCents);
  if (o.bulkyLuggage) push('bulky_luggage', s.bulkyLuggageCents);
  if (o.stops) push('stops', s.perStopCents * o.stops);
  return lines;
}

/** Remise de la promotion sur le tarif, ou une erreur si ses conditions ne sont pas remplies. */
export function applyPromotion(promotion: Promotion, input: QuoteInput, fareCents: number): number {
  const refuse = (why: string): never => {
    throw new PricingError('PROMOTION_NOT_APPLICABLE', `Promotion ${promotion.code} : ${why}`);
  };
  if (promotion.categories && !promotion.categories.includes(input.category)) refuse('catégorie non admissible');
  if (promotion.maxDistanceMeters !== undefined && input.distanceMeters > promotion.maxDistanceMeters) refuse('distance trop longue');
  if (promotion.nthRide !== undefined && (input.clientCompletedRides ?? 0) + 1 !== promotion.nthRide) refuse('rang de course différent');
  const discount = promotion.kind === 'free_ride' ? fareCents : mulDivRound(fareCents, promotion.percentBps ?? 0, 10_000);
  return promotion.maxDiscountCents !== undefined ? Math.min(discount, promotion.maxDiscountCents) : discount;
}

/** Sous-total hors taxes dont le total taxes comprises vaut exactement `totalCents`, ou `null` s'il n'en existe pas. */
export function subtotalForTotal(totalCents: number, rules: PricingRules): number | null {
  const guess = mulDivRound(totalCents, 1_000_000, 1_000_000 + rules.gstRatePpm + rules.qstRatePpm);
  for (const candidate of [guess, guess - 1, guess + 1]) {
    if (candidate + taxes(candidate, rules).gst + taxes(candidate, rules).qst === totalCents) return candidate;
  }
  return null;
}

function taxes(subtotalCents: number, rules: PricingRules): { gst: number; qst: number } {
  return { gst: mulDivRound(subtotalCents, rules.gstRatePpm, 1_000_000), qst: mulDivRound(subtotalCents, rules.qstRatePpm, 1_000_000) };
}

function validate(input: QuoteInput): void {
  const bad = (field: string): never => { throw new PricingError('INVALID_INPUT', `Valeur invalide : ${field}`); };
  if (!Number.isFinite(input.distanceMeters) || input.distanceMeters < 0) bad('distanceMeters');
  if (input.tollsCents !== undefined && (!Number.isFinite(input.tollsCents) || input.tollsCents < 0)) bad('tollsCents');
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 0) bad('durationSeconds');
  if (Number.isNaN(input.pickupAt.getTime())) bad('pickupAt');
  const stops = input.options?.stops ?? 0;
  if (!Number.isInteger(stops) || stops < 0) bad('options.stops');
  if ((input.creditsAvailableCents ?? 0) < 0) bad('creditsAvailableCents');
}

/**
 * Calcule le devis complet d'une course. Fonction pure : mêmes entrées, même résultat.
 * Arrondi au cent ligne par ligne ; le total est la somme des lignes arrondies.
 */
export function computeQuote(input: QuoteInput, rules: PricingRules): Quote {
  validate(input);
  const rule = rules.categories.find((c) => c.category === input.category);
  if (!rule) throw new PricingError('UNKNOWN_CATEGORY', `Catégorie inconnue : ${input.category}`);
  const options = input.options ?? {};
  const lines: QuoteLine[] = [];
  const ignoredOptions: string[] = [];
  let fareCents: number;
  let flat = false;
  let flatRateCode: string | null = null;

  const flatRate = matchFlatRate(rules.flatRates, input.originZone, input.destinationZone);
  const flatTotal = flatRate?.totalCentsByCategory[input.category];
  if (flatTotal !== undefined) {
    // Le forfait remplace tout le calcul et fixe directement le prix total affiché.
    const subtotal = subtotalForTotal(flatTotal, rules);
    if (subtotal === null) throw new PricingError('FLAT_RATE_NOT_DECOMPOSABLE', `Forfait de ${flatTotal} cents indécomposable en lignes arrondies`);
    flat = true;
    flatRateCode = flatRate!.codeByCategory?.[input.category] ?? `${input.originZone}:${input.destinationZone}`;
    fareCents = subtotal - rules.serviceFeeCents - rules.regulatoryFeeCents;
    lines.push({ kind: 'flat_rate', code: 'flat_rate', amountCents: fareCents });
    for (const [name, on] of Object.entries(options)) if (on) ignoredOptions.push(name);
  } else {
    if (options.flex && options.priority) throw new PricingError('FLEX_AND_PRIORITY_EXCLUSIVE', 'Flex et Priorité ne se cumulent pas');
    if (options.flex && isPeakHours(input.pickupAt, rules.peakWindows, rules.timeZone)) {
      throw new PricingError('FLEX_REFUSED_PEAK_HOURS', 'L\'Offre Flex n\'est pas offerte aux heures de pointe');
    }
    const distance = mulDivRound(rule.perKmCents, input.distanceMeters, 1000);
    const duration = mulDivRound(rule.perMinuteCents, input.durationSeconds, 60);
    lines.push({ kind: 'base_fare', code: 'base_fare', amountCents: rule.baseFareCents });
    lines.push({ kind: 'distance', code: 'distance', amountCents: distance });
    lines.push({ kind: 'duration', code: 'duration', amountCents: duration });
    fareCents = rule.baseFareCents + distance + duration;
    if (fareCents < rule.minimumFareCents) {
      lines.push({ kind: 'minimum_adjustment', code: 'minimum_fare', amountCents: rule.minimumFareCents - fareCents });
      fareCents = rule.minimumFareCents;
    }
    for (const line of applySurcharges(input, rules)) { lines.push(line); fareCents += line.amountCents; }
    const multiplier = options.flex ? rules.flexMultiplierBps : options.priority ? rules.priorityMultiplierBps : null;
    if (multiplier !== null) {
      const adjusted = mulDivRound(fareCents, multiplier, 10_000);
      lines.push({ kind: options.flex ? 'flex' : 'priority', code: options.flex ? 'flex' : 'priority', amountCents: adjusted - fareCents });
      fareCents = adjusted;
    }
    if (options.favouriteDriver) {
      lines.push({ kind: 'favourite_driver', code: 'favourite_driver', amountCents: rules.surcharges.favouriteDriverCents });
      fareCents += rules.surcharges.favouriteDriverCents;
    }
  }

  const promotion = input.promotion ?? null;
  const discount = promotion ? applyPromotion(promotion, input, fareCents) : 0;
  const waived = promotion?.kind === 'free_ride' && promotion.waivesFees === true;
  const serviceFeeCents = waived ? 0 : rules.serviceFeeCents;
  const regulatoryFeeCents = waived ? 0 : rules.regulatoryFeeCents;
  // Péages (D33) : ligne du prix affiché, hors tarif chauffeur ; un forfait est tout compris et les ignore.
  const tollsCents = flat ? 0 : Math.max(0, Math.round(input.tollsCents ?? 0));
  if (tollsCents > 0) lines.push({ kind: 'tolls', code: 'tolls', amountCents: tollsCents });
  const subtotalCents = fareCents - discount + serviceFeeCents + regulatoryFeeCents + tollsCents;
  const { gst, qst } = taxes(subtotalCents, rules);
  const totalCents = subtotalCents + gst + qst;
  const creditsAppliedCents = Math.min(input.creditsAvailableCents ?? 0, totalCents);

  return {
    category: input.category, flatRate: flat, flatRateCode, lines, fareCents,
    promotionCode: promotion?.code ?? null, promotionDiscountCents: discount, promotionCompensationCents: discount,
    serviceFeeCents, regulatoryFeeCents, tollsCents, alignmentDiscountCents: 0, subtotalCents, gstCents: gst, qstCents: qst, totalCents,
    creditsAppliedCents, amountDueCents: totalCents - creditsAppliedCents,
    driverAmountCents: fareCents, maxConsentedCents: totalCents + rules.maxExtraAllowanceCents, ignoredOptions,
  };
}

/** Attente facturable : minutes entières au-delà du délai gratuit. */
export function computeWaitChargeCents(waitedSeconds: number, rules: PricingRules): number {
  return Math.max(0, Math.floor((waitedSeconds - rules.waitFreeSeconds) / 60)) * rules.waitPerMinuteCents;
}

/** Prix final à la fin de course : le devis, plus l'attente, sans jamais dépasser le prix maximal consenti. */
export function finalizeQuote(quote: Quote, waitedSeconds: number, rules: PricingRules): Quote {
  const wait = computeWaitChargeCents(waitedSeconds, rules);
  if (wait === 0) return quote;
  const budget = subtotalForTotalAtMost(quote.maxConsentedCents, rules) - quote.subtotalCents;
  const charged = Math.min(wait, Math.max(0, budget));
  const fareCents = quote.fareCents + charged;
  const subtotalCents = quote.subtotalCents + charged;
  const { gst, qst } = taxes(subtotalCents, rules);
  const totalCents = subtotalCents + gst + qst;
  const creditsAppliedCents = quote.creditsAppliedCents;
  return {
    ...quote, lines: [...quote.lines, { kind: 'wait_time', code: 'wait_time', amountCents: charged }],
    fareCents, driverAmountCents: fareCents, subtotalCents, gstCents: gst, qstCents: qst, totalCents,
    amountDueCents: totalCents - creditsAppliedCents,
  };
}

/** Plus grand sous-total dont le total taxes comprises ne dépasse pas `maxTotalCents`. */
export function subtotalForTotalAtMost(maxTotalCents: number, rules: PricingRules): number {
  let subtotal = mulDivRound(maxTotalCents, 1_000_000, 1_000_000 + rules.gstRatePpm + rules.qstRatePpm) + 1;
  while (subtotal + taxes(subtotal, rules).gst + taxes(subtotal, rules).qst > maxTotalCents) subtotal -= 1;
  return subtotal;
}
