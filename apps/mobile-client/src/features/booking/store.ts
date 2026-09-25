import type { PaymentChoice, PaymentMethod, Place, QuotesResponse, RidePreferences, VehicleCategory } from '@neomoov/domain';
import { create } from 'zustand';

export interface BookingOptions {
  childSeat: boolean;
  luggage: boolean;
  flex: boolean;
  priority: boolean;
  favouriteDriverId?: string;
}

/** Brouillon de réservation partagé par les trois écrans (carte, catégorie et prix, commodités et confirmation). */
interface BookingDraft {
  origin: Place | null;
  destination: Place | null;
  /** Arrêts intermédiaires, trois au plus (le devis les tarifie). */
  stops: Place[];
  /** Réservation pour un tiers : le passager reçoit le lien de suivi par texto. */
  forSomeoneElse: boolean;
  passengerName: string;
  passengerPhone: string;
  /** Heure de prise en charge (ISO), au moins 2 heures après la demande (D32). */
  pickupAt: string | null;
  flightNumber: string;
  quotes: QuotesResponse | null;
  category: VehicleCategory | null;
  vehicleId: string | null;
  options: BookingOptions;
  preferences: RidePreferences | null;
  specialRequests: string;
  paymentChoice: PaymentChoice;
  paymentMethod: PaymentMethod;
  /** Clé d'idempotence de la demande : la même pour les nouvelles tentatives après une coupure réseau. */
  idempotencyKey: string;
  update: (patch: Partial<Omit<BookingDraft, 'update' | 'reset' | 'renewKey'>>) => void;
  renewKey: () => void;
  reset: () => void;
}

const newKey = () => `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const initial = () => ({
  origin: null,
  destination: null,
  stops: [] as Place[],
  forSomeoneElse: false,
  passengerName: '',
  passengerPhone: '',
  pickupAt: null,
  flightNumber: '',
  quotes: null,
  category: null,
  vehicleId: null,
  options: { childSeat: false, luggage: false, flex: false, priority: false },
  preferences: null,
  specialRequests: '',
  paymentChoice: 'pay_driver_after' as PaymentChoice,
  paymentMethod: 'cash' as PaymentMethod,
  idempotencyKey: newKey(),
});

export const useBooking = create<BookingDraft>((set) => ({
  ...initial(),
  update: (patch) => set(patch),
  renewKey: () => set({ idempotencyKey: newKey() }),
  reset: () => set(initial()),
}));
