import { describe, expect, it } from 'vitest';
import {
  admittedModels, analyseDriving, currentDocument, daysBetween, deduceVehicleCategory, distanceMeters, documentState, driverApplySchema,
  driverProfileUpdateSchema, gradeQuiz, modelMatches, normalizeModelName, onboardingChecklist, publicTrainingModule, reminderDue,
  scoreSuggestions, trainingComplete, vehicleInputSchema,
  type CategoryRule, type DocumentRecord, type DrivingSample, type OnboardingInput, type ScoreTargets, type TrainingModule,
} from '../src/index.js';

// Catégories de départ (seed), en données : le moteur n'en connaît aucune.
const RULES: CategoryRule[] = [
  { code: 'neo_premium', rank: 1, seats: 4, minYear: 2019, allowedModels: ['Tesla Model 3', 'Tesla Model Y', 'Hyundai Ioniq 5', 'Kia EV6'], active: true },
  { code: 'neo_prestige', rank: 2, seats: 4, minYear: 2021, allowedModels: ['Tesla Model S', 'Tesla Model X', 'Mercedes EQE'], active: true },
  { code: 'neo_xl', rank: 3, seats: 6, minYear: 2019, allowedModels: ['Kia EV9', 'Tesla Model X (7 places)'], active: true },
  { code: 'neo_limo', rank: 4, seats: 4, minYear: 2022, allowedModels: ['Mercedes EQS'], active: false },
];

describe('catégorie déduite du modèle', () => {
  it('normalise les noms (accents, parenthèses, ponctuation)', () => {
    expect(normalizeModelName('  Hyundai IONIQ-5 (Électrique) ')).toBe('hyundai ioniq 5');
    expect(normalizeModelName('Škoda Enyaq')).toBe('skoda enyaq');
  });

  it('reconnaît le modèle exact, le modèle seul et les finitions', () => {
    expect(modelMatches({ make: 'Tesla', model: 'Model 3' }, 'Tesla Model 3')).toBe(true);
    expect(modelMatches({ make: 'TESLA', model: 'model 3 long range' }, 'Tesla Model 3')).toBe(true);
    expect(modelMatches({ make: 'Autre', model: 'Tesla Model 3' }, 'Tesla Model 3')).toBe(true);
    expect(modelMatches({ make: 'X', model: 'Tesla Model 3 Performance' }, 'Tesla Model 3')).toBe(true);
    expect(modelMatches({ make: 'Kia', model: 'EV60' }, 'Kia EV6')).toBe(false);
    expect(modelMatches({ make: 'Kia', model: 'EV6' }, '(vide)')).toBe(false);
  });

  it('retient la catégorie du rang le plus élevé que le véhicule remplit', () => {
    expect(deduceVehicleCategory({ make: 'Tesla', model: 'Model Y', year: 2022, seats: 5 }, RULES)).toEqual({ category: 'neo_premium', refusal: null });
    expect(deduceVehicleCategory({ make: 'Tesla', model: 'Model X', year: 2023, seats: 5 }, RULES)).toEqual({ category: 'neo_prestige', refusal: null });
    expect(deduceVehicleCategory({ make: 'Tesla', model: 'Model X', year: 2023, seats: 7 }, RULES)).toEqual({ category: 'neo_xl', refusal: null });
  });

  it('explique le refus : modèle absent, trop ancien, places insuffisantes ; ignore les catégories inactives', () => {
    expect(deduceVehicleCategory({ make: 'Toyota', model: 'Corolla', year: 2024, seats: 5 }, RULES)).toEqual({ category: null, refusal: 'model_not_listed' });
    expect(deduceVehicleCategory({ make: 'Mercedes', model: 'EQS', year: 2024, seats: 5 }, RULES)).toEqual({ category: null, refusal: 'model_not_listed' });
    expect(deduceVehicleCategory({ make: 'Tesla', model: 'Model S', year: 2020, seats: 5 }, RULES)).toEqual({ category: null, refusal: 'too_old' });
    expect(deduceVehicleCategory({ make: 'Kia', model: 'EV9', year: 2024, seats: 5 }, RULES)).toEqual({ category: null, refusal: 'not_enough_seats' });
  });

  it('liste les modèles admis une seule fois, avec leurs catégories et la plus petite année', () => {
    const list = admittedModels(RULES);
    expect(list.map((m) => m.name)).toEqual(['Hyundai Ioniq 5', 'Kia EV6', 'Kia EV9', 'Mercedes EQE', 'Tesla Model 3', 'Tesla Model S', 'Tesla Model X', 'Tesla Model Y']);
    expect(list.find((m) => m.name === 'Tesla Model X')).toEqual({ name: 'Tesla Model X', categories: ['neo_prestige', 'neo_xl'], minYear: 2019 });
    const doubled = admittedModels([{ ...RULES[0]!, allowedModels: ['Kia EV6', 'KIA EV6'] }]);
    expect(doubled).toEqual([{ name: 'Kia EV6', categories: ['neo_premium'], minYear: 2019 }]);
  });
});

const THRESHOLDS = { harshAccelerationMps2: 2.5, harshBrakingMps2: 3, minGapSeconds: 1, maxGapSeconds: 10 };
// Points le long d'un méridien : 0,0001 degré de latitude vaut environ 11,1 m.
const at = (seconds: number, speedMps: number | null, northMeters = seconds * 10): DrivingSample => ({ at: seconds * 1000, lat: 45.5 + northMeters / 111_195, lng: -73.6, speedMps });

describe('conduite : accélérations et freinages brusques', () => {
  it('calcule les distances', () => {
    expect(Math.round(distanceMeters({ lat: 45.5, lng: -73.6 }, { lat: 45.6, lng: -73.6 }))).toBe(11_119);
  });

  it('compte une accélération et un freinage brusques, un seul événement par épisode', () => {
    const samples = [at(0, 0, 0), at(5, 15, 40), at(10, 28, 150), at(15, 28, 290), at(20, 12, 390), at(25, 0, 420), at(30, 0, 420)];
    const result = analyseDriving(samples, THRESHOLDS);
    expect(result).toMatchObject({ harshAccelerations: 1, harshBrakings: 1, intervals: 6 });
    expect(result.distanceMeters).toBeGreaterThan(400);
  });

  it('déduit la vitesse de la distance quand le GPS ne la donne pas, dans l\'ordre chronologique', () => {
    // 0 → 20 m/s en 5 s (4 m/s²) puis 20 → 0 en 5 s (−4 m/s²), vitesses déduites.
    const samples = [at(10, null, 100), at(0, 0, 0), at(5, null, 0), at(15, null, 100), at(Number.NaN, null, 0)].filter((s) => !Number.isNaN(s.at));
    const result = analyseDriving(samples, THRESHOLDS);
    expect(result.harshAccelerations).toBe(1);
    expect(result.harshBrakings).toBe(1);
  });

  it('ignore les intervalles trop courts, trop longs ou sans vitesse, et coupe les épisodes aux interruptions', () => {
    const samples = [at(0, null, 0), at(0.5, 20, 5), at(3, 20, 55), at(30, 0, 60), at(35, 20, 160), at(35, 25, 170)];
    const result = analyseDriving(samples, THRESHOLDS);
    // 0→0,5 s : trop court ; 3→30 s : trop long ; 30→35 s : 0 → 20 m/s (4 m/s²) ; 35→35 s : durée nulle.
    expect(result.harshAccelerations).toBe(1);
    expect(result.harshBrakings).toBe(0);
    expect(analyseDriving([at(0, Number.POSITIVE_INFINITY, 0), at(5, null, 50)], THRESHOLDS).intervals).toBe(0);
    // Vitesse manquante après une coupure : impossible à déduire, l'intervalle suivant est ignoré.
    expect(analyseDriving([at(0, 10, 0), at(20, null, 200), at(25, 30, 300)], THRESHOLDS)).toMatchObject({ harshAccelerations: 0, intervals: 0 });
    expect(analyseDriving([], THRESHOLDS)).toEqual({ harshAccelerations: 0, harshBrakings: 0, distanceMeters: 0, intervals: 0 });
  });

  it('propose des suggestions, de la plus importante à la moins importante', () => {
    const targets: ScoreTargets = { minRating: 4.6, restrictionRating: 4.4, minPunctualityPct: 90, maxCancellations: 2, maxHarshPer100Km: 2 };
    const good = { punctualityPct: 98, cancellationCount: 0, harshAccelerations: 0, harshBrakings: 0, distanceMeters: 200_000, rating: 4.9, ratingCount: 40 };
    expect(scoreSuggestions(good, targets)).toEqual(['keep_it_up']);
    expect(scoreSuggestions({ ...good, rating: 4.3 }, targets)).toEqual(['rating_restriction']);
    expect(scoreSuggestions({ ...good, rating: 4.5 }, targets)).toEqual(['rating_warning']);
    expect(scoreSuggestions({ ...good, rating: 3, ratingCount: 0 }, targets)).toEqual(['keep_it_up']);
    expect(scoreSuggestions({ ...good, rating: null, punctualityPct: 80, cancellationCount: 3 }, targets)).toEqual(['punctuality', 'cancellations']);
    expect(scoreSuggestions({ ...good, harshAccelerations: 5, harshBrakings: 6 }, targets)).toEqual(['smooth_acceleration', 'smooth_braking']);
    expect(scoreSuggestions({ ...good, harshAccelerations: 5, harshBrakings: 6, distanceMeters: 9_000 }, targets)).toEqual(['keep_it_up']);
  });
});

describe('documents et échéances', () => {
  const today = '2026-09-25';
  it('compte les jours civils', () => {
    expect(daysBetween(today, '2026-10-25')).toBe(30);
    expect(daysBetween(today, '2026-09-24')).toBe(-1);
  });

  it('donne l\'état affiché de chaque document', () => {
    expect(documentState(null, today, 30)).toBe('missing');
    expect(documentState({ status: 'rejected', expiresOn: null }, today, 30)).toBe('rejected');
    expect(documentState({ status: 'expired', expiresOn: null }, today, 30)).toBe('expired');
    expect(documentState({ status: 'approved', expiresOn: '2026-09-24' }, today, 30)).toBe('expired');
    expect(documentState({ status: 'pending', expiresOn: '2027-01-01' }, today, 30)).toBe('pending');
    expect(documentState({ status: 'approved', expiresOn: '2026-10-20' }, today, 30)).toBe('expiring');
    expect(documentState({ status: 'approved', expiresOn: '2027-10-20' }, today, 30)).toBe('approved');
    expect(documentState({ status: 'approved', expiresOn: null }, today, 30)).toBe('approved');
  });

  it('garde le document valide pendant l\'examen de son remplaçant', () => {
    const doc = (status: DocumentRecord['status'], expiresOn: string | null, day: number): DocumentRecord => ({ type: 'insurance', status, expiresOn, createdAt: new Date(Date.UTC(2026, 8, day)) });
    expect(currentDocument([], 'insurance', today)).toEqual({ current: null, replacement: null });
    const old = doc('approved', '2026-10-10', 1);
    const fresh = doc('pending', '2027-10-10', 20);
    expect(currentDocument([old, fresh], 'insurance', today)).toEqual({ current: old, replacement: fresh });
    const forever = doc('approved', null, 2);
    expect(currentDocument([forever, fresh], 'insurance', today)).toEqual({ current: forever, replacement: fresh });
    const lapsed = doc('approved', '2026-09-01', 1);
    expect(currentDocument([lapsed, fresh], 'insurance', today)).toEqual({ current: fresh, replacement: null });
    expect(currentDocument([fresh, old], 'licence', today)).toEqual({ current: null, replacement: null });
    expect(currentDocument([fresh, old], 'insurance', today).current).toBe(old);
    expect(currentDocument([old], 'insurance', today)).toEqual({ current: old, replacement: null });
  });

  it('déclenche les rappels à J-30, J-7 et J-1', () => {
    expect(reminderDue(null, today, [30, 7, 1])).toBeNull();
    expect(reminderDue('2026-10-02', today, [30, 7, 1])).toBe(7);
    expect(reminderDue('2026-10-03', today, [30, 7, 1])).toBeNull();
  });
});

const MODULE: TrainingModule = {
  code: 'service',
  title: { fr: 'Service', en: 'Service' },
  summary: { fr: 'Résumé', en: 'Summary' },
  videoUrl: null,
  durationMinutes: 10,
  questions: [
    { id: 'q1', prompt: { fr: 'Q1', en: 'Q1' }, choices: [{ fr: 'A', en: 'A' }, { fr: 'B', en: 'B' }], answerIndex: 1 },
    { id: 'q2', prompt: { fr: 'Q2', en: 'Q2' }, choices: [{ fr: 'A', en: 'A' }, { fr: 'B', en: 'B' }], answerIndex: 0 },
  ],
};

describe('formation', () => {
  it('corrige le quiz côté serveur (sans réponse = faux)', () => {
    expect(gradeQuiz(MODULE, { q1: 1, q2: 0 }, 80)).toEqual({ correct: 2, total: 2, scorePct: 100, passed: true });
    expect(gradeQuiz(MODULE, { q1: 1 }, 80)).toEqual({ correct: 1, total: 2, scorePct: 50, passed: false });
    expect(gradeQuiz({ ...MODULE, questions: [] }, {}, 80)).toEqual({ correct: 0, total: 0, scorePct: 100, passed: true });
  });

  it('n\'envoie jamais les bonnes réponses à l\'application', () => {
    const shown = publicTrainingModule(MODULE);
    expect(JSON.stringify(shown)).not.toContain('answerIndex');
    expect(shown.questions[0]).toEqual({ id: 'q1', prompt: { fr: 'Q1', en: 'Q1' }, choices: MODULE.questions[0]!.choices });
  });

  it('délivre l\'attestation quand chaque module est réussi', () => {
    expect(trainingComplete([], new Set())).toBe(false);
    expect(trainingComplete([{ code: 'a' }, { code: 'b' }], new Set(['a']))).toBe(false);
    expect(trainingComplete([{ code: 'a' }, { code: 'b' }], new Set(['a', 'b']))).toBe(true);
  });
});

describe('assistant d\'inscription', () => {
  const base: OnboardingInput = {
    profileComplete: true, vehicleStatus: 'active', documents: ['approved', 'expiring'], trainingCertified: true,
    payout: { linked: true, onboarded: true }, payoutRequired: false, packActive: true, packRequired: true, driverStatus: 'active',
  };
  const stateOf = (input: OnboardingInput, code: string) => onboardingChecklist(input).steps.find((s) => s.code === code)!.state;

  it('dossier complet', () => {
    expect(onboardingChecklist(base)).toMatchObject({ next: null, complete: true });
    expect(stateOf({ ...base, driverStatus: 'restricted' }, 'activation')).toBe('done');
  });

  it('reprend à la première étape à faire', () => {
    const fresh: OnboardingInput = { ...base, profileComplete: false, vehicleStatus: null, documents: ['missing'], trainingCertified: false, payout: { linked: false, onboarded: false }, packActive: false, driverStatus: 'pending' };
    const list = onboardingChecklist(fresh);
    expect(list.next).toBe('profile');
    expect(list.complete).toBe(false);
    expect(list.steps.map((s) => s.state)).toEqual(['todo', 'todo', 'todo', 'todo', 'optional', 'todo', 'in_review']);
    expect(onboardingChecklist({ ...fresh, profileComplete: true }).next).toBe('vehicle');
  });

  it('distingue l\'examen en cours et l\'action requise', () => {
    expect(stateOf({ ...base, vehicleStatus: 'pending' }, 'vehicle')).toBe('in_review');
    expect(stateOf({ ...base, vehicleStatus: 'non_compliant' }, 'vehicle')).toBe('action_required');
    expect(stateOf({ ...base, documents: ['approved', 'pending'] }, 'documents')).toBe('in_review');
    expect(stateOf({ ...base, documents: ['missing', 'rejected'] }, 'documents')).toBe('action_required');
    expect(stateOf({ ...base, documents: ['expired'] }, 'documents')).toBe('action_required');
    expect(stateOf({ ...base, payout: { linked: true, onboarded: false } }, 'payout')).toBe('in_review');
    expect(stateOf({ ...base, payout: { linked: false, onboarded: false }, payoutRequired: true }, 'payout')).toBe('todo');
    expect(stateOf({ ...base, packActive: false, packRequired: false }, 'pack')).toBe('optional');
    expect(stateOf({ ...base, driverStatus: 'suspended' }, 'activation')).toBe('action_required');
    expect(onboardingChecklist({ ...base, documents: ['pending'], driverStatus: 'pending' }).next).toBeNull();
  });
});

describe('schémas de l\'espace chauffeur', () => {
  it('valide la candidature, les numéros de taxes et le véhicule', () => {
    expect(driverApplySchema.safeParse({ firstName: 'Awa', lastName: 'Diallo', qualification: 'registered' }).success).toBe(true);
    expect(driverApplySchema.safeParse({ firstName: 'Awa', lastName: 'Diallo', qualification: 'autre' }).success).toBe(false);
    expect(driverProfileUpdateSchema.parse({ gstNumber: '123456789 rt0001', qstNumber: '1234567890TQ0001' })).toEqual({ gstNumber: '123456789 RT0001', qstNumber: '1234567890TQ0001' });
    expect(driverProfileUpdateSchema.safeParse({ gstNumber: '12345' }).success).toBe(false);
    const vehicle = vehicleInputSchema.parse({ make: 'Tesla', model: 'Model Y', year: 2023, colour: 'Blanc', plate: 'f12 abc', seats: 5 });
    expect(vehicle.plate).toBe('F12 ABC');
    expect(vehicle.equipment).toMatchObject({ childSeat: false, water: true });
    expect(vehicleInputSchema.safeParse({ make: 'Tesla', model: 'Model Y', year: 2023, colour: 'Blanc', plate: 'F12ABC', seats: 5, vin: 'IOQ12345678901234' }).success).toBe(false);
  });
});
