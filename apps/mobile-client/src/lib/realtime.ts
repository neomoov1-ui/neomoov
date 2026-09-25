import type { RideView } from '@neomoov/domain';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from './config';
import { keys, queryClient } from './queries';
import { useSession } from './session';

let socket: Socket | null = null;

/** Socket de l'espace `/client` (7.3), partagé par l'application ; le jeton est relu à chaque connexion (après rotation). */
function clientSocket(): Socket {
  socket ??= io(`${API_BASE_URL}/client`, {
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

interface DriverPosition {
  lat: number;
  lng: number;
  recordedAt: string;
}

/**
 * Suivi en direct d'une course : état (`ride.updated`), position du chauffeur (`driver.location`, toutes les 2 à
 * 5 secondes), offres de négociation et messages. `connected` à faux déclenche le rafraîchissement HTTP de `useRide`.
 */
export function useRideLive(rideId: string, enabled: boolean): { connected: boolean; driverPosition: DriverPosition | null } {
  const [connected, setConnected] = useState(false);
  const [driverPosition, setDriverPosition] = useState<DriverPosition | null>(null);

  useEffect(() => {
    if (!enabled || !rideId) return;
    const s = clientSocket();
    const subscribe = () => {
      setConnected(true);
      s.emit('ride.subscribe', { rideId }, (ack: { ok: boolean; ride?: RideView }) => {
        if (ack?.ok && ack.ride) queryClient.setQueryData(keys.ride(rideId), ack.ride);
      });
    };
    const onDisconnect = () => setConnected(false);
    const onRide = (view: RideView) => {
      if (view?.id !== rideId) return;
      queryClient.setQueryData(keys.ride(rideId), view);
      void queryClient.invalidateQueries({ queryKey: keys.rides });
    };
    const onLocation = (event: { rideId: string | null; coordinates: { lat: number; lng: number }; recordedAt: string }) => {
      if (event?.rideId === rideId) setDriverPosition({ ...event.coordinates, recordedAt: event.recordedAt });
    };
    const onOffers = (event: { rideId?: string }) => {
      if (event?.rideId === rideId) void queryClient.invalidateQueries({ queryKey: keys.offers(rideId) });
    };
    const onMessage = (event: { rideId?: string }) => {
      if (event?.rideId === rideId) void queryClient.invalidateQueries({ queryKey: keys.messages(rideId) });
    };
    s.on('connect', subscribe);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onDisconnect);
    s.on('ride.updated', onRide);
    s.on('driver.location', onLocation);
    s.on('offers.updated', onOffers);
    s.on('message.received', onMessage);
    if (s.connected) subscribe();
    else s.connect();
    return () => {
      s.emit('ride.unsubscribe', { rideId });
      s.off('connect', subscribe);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onDisconnect);
      s.off('ride.updated', onRide);
      s.off('driver.location', onLocation);
      s.off('offers.updated', onOffers);
      s.off('message.received', onMessage);
    };
  }, [rideId, enabled]);

  return { connected, driverPosition };
}
