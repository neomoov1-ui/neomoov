import type { DriverOfferView, RideView } from '@neomoov/domain';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from './config';
import { keys, queryClient } from './queries';
import { useSession } from './session';

let socket: Socket | null = null;

/** Socket de l'espace `/driver` (7.3) ; le jeton est relu à chaque connexion (après rotation). */
function driverSocket(): Socket {
  socket ??= io(`${API_BASE_URL}/driver`, {
    transports: ['websocket'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelayMax: 10_000,
    auth: (cb) => cb({ token: useSession.getState().accessToken ?? '' }),
  });
  return socket;
}

export function disconnectRealtime(): void {
  socket?.disconnect();
}

/** Offres reçues par le socket ; l'écran d'offre plein écran s'ouvre sur la plus ancienne. */
function upsertOffer(offer: DriverOfferView): void {
  queryClient.setQueryData<DriverOfferView[]>(keys.offers, (list = []) => [...list.filter((o) => o.id !== offer.id), offer].sort((a, b) => a.sentAt.localeCompare(b.sentAt)));
}

function removeOffer(offerId: string): void {
  queryClient.setQueryData<DriverOfferView[]>(keys.offers, (list = []) => list.filter((o) => o.id !== offerId));
}

/**
 * Connexion au socket tant que le chauffeur est connecté : offre nouvelle (écran plein écran, sonnerie), offre expirée,
 * course mise à jour, message reçu. `connected` à faux déclenche les rafraîchissements HTTP de repli.
 */
export function useDriverRealtime(enabled: boolean): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const s = driverSocket();
    const onConnect = () => {
      setConnected(true);
      void queryClient.invalidateQueries({ queryKey: keys.offers });
    };
    const onDisconnect = () => setConnected(false);
    const onOffer = (offer: DriverOfferView) => {
      if (!offer?.id) return;
      upsertOffer(offer);
      router.push({ pathname: '/offer/[id]', params: { id: offer.id } });
    };
    const onExpired = (event: { offerId?: string }) => {
      if (event?.offerId) removeOffer(event.offerId);
    };
    const onRide = (view: RideView) => {
      if (!view?.id) return;
      void queryClient.invalidateQueries({ queryKey: keys.ride(view.id) });
      void queryClient.invalidateQueries({ queryKey: keys.rides });
      void queryClient.invalidateQueries({ queryKey: keys.home });
    };
    const onMessage = (event: { rideId?: string }) => {
      if (event?.rideId) void queryClient.invalidateQueries({ queryKey: keys.messages(event.rideId) });
    };
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onDisconnect);
    s.on('offer.new', onOffer);
    s.on('offer.expired', onExpired);
    s.on('ride.updated', onRide);
    s.on('message.received', onMessage);
    if (s.connected) onConnect();
    else s.connect();
    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onDisconnect);
      s.off('offer.new', onOffer);
      s.off('offer.expired', onExpired);
      s.off('ride.updated', onRide);
      s.off('message.received', onMessage);
      s.disconnect();
    };
  }, [enabled]);
  return { connected };
}

/** Abonnement aux événements d'une course (état, messages) pendant qu'elle est à l'écran. */
export function useRideSubscription(rideId: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !rideId) return;
    const s = driverSocket();
    const subscribe = () => s.emit('ride.subscribe', { rideId }, () => undefined);
    s.on('connect', subscribe);
    if (s.connected) subscribe();
    return () => {
      s.off('connect', subscribe);
    };
  }, [rideId, enabled]);
}
