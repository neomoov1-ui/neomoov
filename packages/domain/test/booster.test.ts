import { describe, expect, it } from 'vitest';
import {
  addDays, aggregatePerformance, alertTestSchema, BODY_ZONES, DEFAULT_ALERT_SETTINGS, defaultInspectionItems, driverAlertSettingsUpdateSchema, dueAlerts, INSPECTION_ITEMS,
  inspectionAnalysisSchema, inspectionConfirmSchema, inspectionCreateFieldsSchema, inspectionItemsSchema, isoWeekLabel, localMoment, majorItems, minutesOfDay, normalizePlate,
  overallSeverity, parseAlertSettings, parseGainWindows, performanceLogInputSchema, performanceReadingSchema, performanceSummary, periodBounds, prefillFromAnalysis,
  prefillFromReading, pruneMarkers, type AlertContext, type InspectionAnalysis, type PerformanceFigures, type PerformanceReading,
} from '../src/index.js';

const analysis = (overrides: Partial<InspectionAnalysis> = {}): InspectionAnalysis => inspectionAnalysisSchema.parse({
  odometerKm: 123_456, energyPercent: 80, plate: 'abc 123', warningLights: [], defects: [], items: [],
  confidence: { odometerKm: 0.9, energyPercent: 0.8, plate: 0.7, warningLights: 1, defects: 0.6, items: 0.5 },
  photosUnusable: [], summary: 'Véhicule propre, aucun défaut visible.', ...overrides,
});

describe('vérification sommaire : éléments, gravité, préremplissage', () => {
  it('démarre avec les douze éléments conformes et sans observation', () => {
    const items = defaultInspectionItems();
    expect(Object.keys(items)).toEqual([...INSPECTION_ITEMS]);
    expect(Object.values(items).every((i) => i.state === 'ok' && i.note === null)).toBe(true);
    expect(inspectionItemsSchema.parse(items)).toEqual(items);
    expect(majorItems(items)).toEqual([]);
  });

  it('calcule la gravité globale : majeure, mineure (élément ou zone), conforme', () => {
    const items = defaultInspectionItems();
    expect(overallSeverity(items, [])).toBe('ok');
    expect(overallSeverity(items, [{ zone: 'roof', description: 'rayure' }])).toBe('minor');
    items.wipers = { state: 'minor', note: 'balai usé' };
    expect(overallSeverity(items, [])).toBe('minor');
    items.tires = { state: 'major', note: null };
    expect(overallSeverity(items, [])).toBe('major');
    expect(majorItems(items)).toEqual(['tires']);
    items.ramp = { state: 'na', note: null };
    expect(overallSeverity({ ...defaultInspectionItems(), ramp: { state: 'na', note: null } }, [])).toBe('ok');
  });

  it('normalise la plaque', () => {
    expect(normalizePlate(' abc-123 ')).toBe('ABC123');
    expect(normalizePlate('')).toBeNull();
    expect(normalizePlate(null)).toBeNull();
    expect(normalizePlate(undefined)).toBeNull();
    expect(normalizePlate('1234567890123456')).toHaveLength(12);
  });

  it('préremplit le rapport sans défaut : champs lus, éléments inchangés, confiance moyenne', () => {
    const prefill = prefillFromAnalysis(analysis());
    expect(prefill.odometerKm).toBe(123_456);
    expect(prefill.energyPercent).toBe(80);
    expect(prefill.plate).toBe('ABC123');
    expect(prefill.warningLightOn).toBe(false);
    expect(prefill.warningLightReason).toBeNull();
    expect(prefill.itemsFromAnalysis).toEqual([]);
    expect(prefill.bodyZones).toEqual([]);
    expect(prefill.severity).toBe('ok');
    expect(prefill.confidence).toBe(0.75);
    expect(prefill.photosUnusable).toEqual([]);
  });

  it('préremplit depuis des défauts, des voyants et des éléments lus ; un pneu usé majeur met « pneus » en majeur', () => {
    const prefill = prefillFromAnalysis(analysis({
      plate: null,
      warningLights: [{ name: 'Pression des pneus', probableCause: 'pneu sous-gonflé' }, { name: 'ABS', probableCause: '' }],
      defects: [
        { zone: 'front_left', kind: 'scratch', description: 'rayure de 10 cm', severity: 'minor' },
        { zone: 'front_left', kind: 'dent', description: '', severity: 'minor' },
        { zone: 'rear_right', kind: 'worn_tire', description: 'bande de roulement lisse', severity: 'major' },
        { zone: 'left_side', kind: 'worn_tire', description: '', severity: 'major' },
      ],
      items: [{ item: 'lights', state: 'ok', observation: null }, { item: 'mirrors', state: 'minor', observation: '  fissuré ' }, { item: 'tires', state: 'ok', observation: '' }],
      photosUnusable: [3, 1, 3],
    }));
    expect(prefill.plate).toBeNull();
    expect(prefill.warningLightOn).toBe(true);
    expect(prefill.warningLightReason).toBe('Pression des pneus (pneu sous-gonflé) ; ABS');
    expect(prefill.items.warning_lights).toEqual({ state: 'minor', note: 'Pression des pneus (pneu sous-gonflé) ; ABS' });
    expect(prefill.items.mirrors).toEqual({ state: 'minor', note: 'fissuré' });
    expect(prefill.items.lights).toEqual({ state: 'ok', note: null });
    expect(prefill.items.tires).toEqual({ state: 'major', note: 'bande de roulement lisse' });
    expect(prefill.itemsFromAnalysis).toEqual(['lights', 'mirrors', 'tires', 'warning_lights']);
    expect(prefill.bodyZones).toEqual([
      { zone: 'front_left', description: 'rayure : rayure de 10 cm ; bosse' },
      { zone: 'rear_right', description: 'pneu usé : bande de roulement lisse' },
      { zone: 'left_side', description: 'pneu usé' },
    ]);
    expect(prefill.severity).toBe('major');
    expect(prefill.photosUnusable).toEqual([1, 3]);
  });

  it('ne remplace pas une défectuosité déjà saisie par le chauffeur et garde un voyant déjà noté', () => {
    const base = defaultInspectionItems();
    base.mirrors = { state: 'major', note: 'cassé' };
    base.warning_lights = { state: 'major', note: 'moteur' };
    base.tires = { state: 'na', note: null };
    const prefill = prefillFromAnalysis(analysis({
      warningLights: [{ name: 'Huile', probableCause: 'niveau bas' }],
      items: [{ item: 'mirrors', state: 'ok', observation: null }, { item: 'tires', state: 'minor', observation: null }],
      defects: [{ zone: 'rear_left', kind: 'worn_tire', description: 'lisse', severity: 'major' }, { zone: 'roof', kind: 'other', description: 'tache', severity: 'minor' }],
    }), base);
    expect(prefill.items.mirrors).toEqual({ state: 'major', note: 'cassé' });
    expect(prefill.items.warning_lights).toEqual({ state: 'major', note: 'moteur' });
    // `tires` était « sans objet » : l'analyse le remplit (mineur), puis le pneu usé majeur l'emporte sans doublon.
    expect(prefill.items.tires).toEqual({ state: 'major', note: 'lisse' });
    expect(prefill.itemsFromAnalysis).toEqual(['tires']);
    expect(prefill.bodyZones.map((z) => z.zone)).toEqual(['rear_left', 'roof']);
  });

  it('un second pneu usé majeur ne réécrit pas l\'élément déjà majeur', () => {
    const prefill = prefillFromAnalysis(analysis({
      defects: [{ zone: 'rear_left', kind: 'worn_tire', description: 'lisse', severity: 'major' }, { zone: 'rear_right', kind: 'worn_tire', description: 'autre', severity: 'major' }, { zone: 'front_left', kind: 'worn_tire', description: 'léger', severity: 'minor' }],
    }));
    expect(prefill.items.tires).toEqual({ state: 'major', note: 'lisse' });
    expect(prefill.itemsFromAnalysis).toEqual(['tires']);
  });

  it('un pneu usé sans description prend le libellé du défaut ; un voyant lu comme élément compte une seule fois', () => {
    const worn = prefillFromAnalysis(analysis({ defects: [{ zone: 'rear_left', kind: 'worn_tire', description: '  ', severity: 'major' }] }));
    expect(worn.items.tires).toEqual({ state: 'major', note: 'pneu usé' });
    const lights = prefillFromAnalysis(analysis({ warningLights: [{ name: 'Moteur', probableCause: '' }], items: [{ item: 'warning_lights', state: 'ok', observation: null }] }));
    expect(lights.items.warning_lights).toEqual({ state: 'minor', note: 'Moteur' });
    expect(lights.itemsFromAnalysis).toEqual(['warning_lights']);
  });

  it('valide les schémas de l\'API : création multipart, confirmation', () => {
    expect(inspectionCreateFieldsSchema.parse({ plate: ' ABC 123 ', kinds: 'front_left,other' })).toEqual({ plate: 'ABC 123', kinds: 'front_left,other' });
    expect(inspectionConfirmSchema.safeParse({ allItemsChecked: false }).success).toBe(false);
    expect(inspectionConfirmSchema.parse({ allItemsChecked: true, bodyZones: [{ zone: BODY_ZONES[0], description: 'x' }] }).bodyZones).toHaveLength(1);
  });
});

const figures = (overrides: Partial<PerformanceFigures> = {}): PerformanceFigures => ({
  startedAt: new Date('2026-10-05T11:00:00Z'), endedAt: new Date('2026-10-05T19:30:00Z'),
  startEnergyPercent: 90, endEnergyPercent: 40, startOdometerKm: 10_000, endOdometerKm: 10_200,
  onlineMinutes: 480, drivingMinutes: 300, ridesCount: 12, ridesCents: 24_000, tipsCents: 2_400, promotionsCents: 1_000, energyCents: 1_500, cleaningCents: 500,
  ...overrides,
});

describe('rapport de performance : calculs d\'une session et récapitulatifs', () => {
  it('calcule différences, solde et ratios sur une session complète', () => {
    const s = performanceSummary(figures());
    expect(s.sessionMinutes).toBe(510);
    expect(s.basisMinutes).toBe(480);
    expect(s.distanceKm).toBe(200);
    expect(s.energyUsedPoints).toBe(50);
    expect(s.energyPer100Km).toBe(25);
    expect(s.drivingSharePercent).toBe(63);
    expect(s.grossCents).toBe(27_400);
    expect(s.costsCents).toBe(2_000);
    expect(s.netCents).toBe(25_400);
    expect(s.netPerHourCents).toBe(3_175);
    expect(s.netPerKmCents).toBe(127);
    expect(s.grossPerRideCents).toBe(2_000);
    expect(s.tipsPercent).toBe(10);
  });

  it('laisse nuls les ratios dont les bases manquent ou sont incohérentes', () => {
    const s = performanceSummary(figures({ startedAt: new Date('2026-10-05T19:00:00Z'), endedAt: new Date('2026-10-05T11:00:00Z'), onlineMinutes: null, drivingMinutes: null, startOdometerKm: 500, endOdometerKm: 400, startEnergyPercent: null, ridesCount: 0, ridesCents: 0, tipsCents: 0, promotionsCents: 0 }));
    expect(s.sessionMinutes).toBeNull();
    expect(s.basisMinutes).toBeNull();
    expect(s.distanceKm).toBeNull();
    expect(s.energyUsedPoints).toBeNull();
    expect(s.energyPer100Km).toBeNull();
    expect(s.drivingSharePercent).toBeNull();
    expect(s.netCents).toBe(-2_000);
    expect(s.netPerHourCents).toBeNull();
    expect(s.netPerKmCents).toBeNull();
    expect(s.grossPerRideCents).toBeNull();
    expect(s.tipsPercent).toBeNull();
  });

  it('prend la durée de session comme base horaire sans temps en ligne, et ignore une recharge en cours de session', () => {
    const s = performanceSummary(figures({ onlineMinutes: null, startEnergyPercent: 40, endEnergyPercent: 90, startOdometerKm: null }));
    expect(s.basisMinutes).toBe(510);
    expect(s.energyUsedPoints).toBe(-50);
    expect(s.energyPer100Km).toBeNull();
    expect(s.netPerHourCents).toBe(2_988);
    expect(performanceSummary(figures({ onlineMinutes: 0, drivingMinutes: 10 })).drivingSharePercent).toBeNull();
    expect(performanceSummary(figures({ startOdometerKm: 100, endOdometerKm: 100 })).netPerKmCents).toBeNull();
  });

  it('additionne les sessions d\'une période', () => {
    const a = figures();
    const b = figures({ startOdometerKm: null, onlineMinutes: null, startedAt: null, ridesCount: null, tipsCents: 0 });
    const totals = aggregatePerformance([{ figures: a, summary: performanceSummary(a) }, { figures: b, summary: performanceSummary(b) }]);
    expect(totals).toEqual({ sessions: 2, minutes: 480, distanceKm: 200, rides: 12, grossCents: 52_400, tipsCents: 2_400, costsCents: 4_000, netCents: 48_400, netPerHourCents: 6_050, netPerKmCents: 242 });
    expect(aggregatePerformance([])).toEqual({ sessions: 0, minutes: 0, distanceKm: 0, rides: 0, grossCents: 0, tipsCents: 0, costsCents: 0, netCents: 0, netPerHourCents: null, netPerKmCents: null });
  });

  it('borne les périodes civiles et numérote les semaines', () => {
    expect(periodBounds('2026-10-07', 'week')).toEqual({ start: '2026-10-05', end: '2026-10-11' });
    expect(periodBounds('2026-10-04', 'week')).toEqual({ start: '2026-09-28', end: '2026-10-04' });
    expect(periodBounds('2026-10-07', 'month')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(periodBounds('2026-12-15', 'month')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(periodBounds('2028-02-10', 'month')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isoWeekLabel('2026-10-07')).toBe('2026-W41');
    expect(isoWeekLabel('2027-01-01')).toBe('2026-W53');
    expect(isoWeekLabel('2026-01-01')).toBe('2026-W01');
    expect(isoWeekLabel('2026-10-04')).toBe('2026-W40');
  });

  it('préremplit la saisie depuis une lecture de captures', () => {
    const reading: PerformanceReading = performanceReadingSchema.parse({
      app: ' Uber ', date: '2026-10-05', startedAt: '07:00', endedAt: null, ridesCents: 15_000, tipsCents: null, promotionsCents: 500, ridesCount: 9, onlineMinutes: 420, drivingMinutes: null,
      confidence: { amounts: 0.9, counts: 0.8, times: 0.4 }, photosUnusable: [2, 0, 2], summary: 'Résumé de la journée lu sur deux captures.',
    });
    expect(prefillFromReading(reading)).toEqual({
      ridesCents: 15_000, tipsCents: null, promotionsCents: 500, ridesCount: 9, onlineMinutes: 420, drivingMinutes: null, startedTime: '07:00', endedTime: null, app: 'Uber', date: '2026-10-05', confidence: 0.7, photosUnusable: [0, 2],
    });
    expect(prefillFromReading({ ...reading, app: '   ' }).app).toBeNull();
    expect(prefillFromReading({ ...reading, app: null }).app).toBeNull();
    expect(performanceLogInputSchema.parse({ ridesCents: 100, otherNotes: ' x ' })).toEqual({ ridesCents: 100, otherNotes: 'x' });
  });
});

describe('alertes : réglages et alertes dues', () => {
  /** Lundi 5 octobre 2026 à Montréal (UTC-4) : 7 h 02. */
  const at = (iso: string) => new Date(iso);
  const windows = parseGainWindows([
    { label: { fr: 'Aéroport', en: 'Airport' }, days: [0, 1, 2, 3, 4, 5, 6], from: '05:00', to: '09:00', zone: 'yul' },
    { label: { fr: 'Soirées', en: 'Evenings' }, days: [5, 6], from: '17:00', to: '02:00' },
  ]);
  const ctx = (overrides: Partial<AlertContext> = {}): AlertContext => ({
    now: at('2026-10-05T11:02:00Z'), settings: DEFAULT_ALERT_SETTINGS, peakPeriods: windows, peakZones: windows, hasInspectionToday: false, toleranceMinutes: 5, sent: new Set(), ...overrides,
  });

  it('lit les réglages et les fenêtres, et retombe sur les défauts si illisibles', () => {
    expect(parseAlertSettings(null)).toBe(DEFAULT_ALERT_SETTINGS);
    expect(parseAlertSettings({ ...DEFAULT_ALERT_SETTINGS, sessionStart: '06:30' }).sessionStart).toBe('06:30');
    expect(parseGainWindows('non')).toEqual([]);
    expect(windows).toHaveLength(2);
    expect(minutesOfDay('17:45')).toBe(1065);
    expect(driverAlertSettingsUpdateSchema.parse({ reminders: { inspection: false }, styles: { peak_zone: { sound: 'none', color: '#000000' } } })).toEqual({ reminders: { inspection: false }, styles: { peak_zone: { sound: 'none', color: '#000000' } } });
    expect(driverAlertSettingsUpdateSchema.safeParse({ sessionStart: '25:00' }).success).toBe(false);
    expect(alertTestSchema.parse({ type: 'peak_zone' }).type).toBe('peak_zone');
  });

  it('calcule le moment local dans le fuseau du chauffeur, avec repli sur Montréal', () => {
    expect(localMoment(at('2026-10-05T11:02:00Z'), 'America/Toronto')).toEqual({ date: '2026-10-05', weekday: 1, minutes: 422 });
    expect(localMoment(at('2026-10-05T03:30:00Z'), 'America/Toronto')).toEqual({ date: '2026-10-04', weekday: 0, minutes: 1410 });
    expect(localMoment(at('2026-10-05T11:02:00Z'), 'Fuseau/Inconnu')).toEqual({ date: '2026-10-05', weekday: 1, minutes: 422 });
    expect(localMoment(at('2026-10-05T04:00:00Z'), 'America/Toronto').minutes).toBe(0);
  });

  it('à l\'heure de début : vérification sommaire (sans inspection du jour), informations et début de session', () => {
    const due = dueAlerts(ctx());
    expect(due.map((d) => d.type)).toEqual(['inspection', 'session_info', 'session_start']);
    expect(due[0]).toEqual({ type: 'inspection', marker: 'inspection:2026-10-05', style: DEFAULT_ALERT_SETTINGS.styles.inspection, window: null });
    expect(dueAlerts(ctx({ hasInspectionToday: true })).map((d) => d.type)).toEqual(['session_info', 'session_start']);
    expect(dueAlerts(ctx({ sent: new Set(['session_info:2026-10-05']) })).map((d) => d.type)).toEqual(['inspection', 'session_start']);
    expect(dueAlerts(ctx({ settings: { ...DEFAULT_ALERT_SETTINGS, reminders: { ...DEFAULT_ALERT_SETTINGS.reminders, inspection: false, session_start: false } } })).map((d) => d.type)).toEqual(['session_info']);
  });

  it('respecte la tolérance : rien avant l\'heure ni après la fenêtre', () => {
    expect(dueAlerts(ctx({ now: at('2026-10-05T10:59:00Z') }))).toEqual([]);
    expect(dueAlerts(ctx({ now: at('2026-10-05T11:05:00Z') }))).toEqual([]);
    expect(dueAlerts(ctx({ now: at('2026-10-05T11:04:59Z') })).map((d) => d.type)).toEqual(['inspection', 'session_info', 'session_start']);
  });

  it('à l\'heure de fin : rapport de performance ; aux fenêtres de gain : période et zone selon le jour', () => {
    expect(dueAlerts(ctx({ now: at('2026-10-05T21:01:00Z') })).map((d) => d.marker)).toEqual(['session_end:2026-10-05']);
    const airport = dueAlerts(ctx({ now: at('2026-10-05T09:00:00Z') }));
    expect(airport.map((d) => d.marker)).toEqual(['peak_period:2026-10-05:0', 'peak_zone:2026-10-05:0']);
    expect(airport[1]!.window?.zone).toBe('yul');
    // Lundi 17 h : la fenêtre des soirées (vendredi, samedi) ne s'applique pas.
    expect(dueAlerts(ctx({ now: at('2026-10-05T21:00:00Z'), settings: { ...DEFAULT_ALERT_SETTINGS, sessionEnd: '23:00' } }))).toEqual([]);
    // Vendredi 9 octobre 2026, 17 h.
    expect(dueAlerts(ctx({ now: at('2026-10-09T21:00:00Z'), settings: { ...DEFAULT_ALERT_SETTINGS, sessionEnd: '23:00' } })).map((d) => d.marker)).toEqual(['peak_period:2026-10-09:1', 'peak_zone:2026-10-09:1']);
    expect(dueAlerts(ctx({ now: at('2026-10-09T21:00:00Z'), settings: { ...DEFAULT_ALERT_SETTINGS, sessionEnd: '23:00' }, sent: new Set(['peak_period:2026-10-09:1']) })).map((d) => d.marker)).toEqual(['peak_zone:2026-10-09:1']);
  });

  it('garde seulement les marques du jour et de la veille', () => {
    expect(pruneMarkers(['inspection:2026-10-05', 'peak_period:2026-10-04:1', 'session_end:2026-10-01'], '2026-10-05', '2026-10-04')).toEqual(['inspection:2026-10-05', 'peak_period:2026-10-04:1']);
  });
});
