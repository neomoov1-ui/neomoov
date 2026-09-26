'use client';

/**
 * Socket `/admin` de My Hub : le jeton d'accès court est redemandé à la passerelle à chaque (re)connexion (il n'est
 * jamais stocké dans la page). Sans socket, les écrans se rafraîchissent périodiquement (repli).
 */
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { fetchSession } from '@/lib/hub-api';
import { API_BASE_URL } from '@/lib/site-api';

export interface DriverLocationEvent {
  rideId: string | null;
  driverId: string;
  coordinates: { lat: number; lng: number };
  headingDegrees?: number | null;
  recordedAt: string;
}

export interface AdminAlertEvent {
  type: string;
  severity: string;
  rideId?: string;
  incidentId?: string;
  at: string;
}

export interface AdminSocketHandlers {
  onLocation?: (event: DriverLocationEvent) => void;
  onRide?: (ride: { id: string; state: string }) => void;
  onAlert?: (alert: AdminAlertEvent) => void;
}

export function useAdminSocket(handlers: AdminSocketHandlers): boolean {
  const [connected, setConnected] = useState(false);
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const socket: Socket = io(`${API_BASE_URL}/admin`, {
      transports: ['websocket'],
      reconnectionDelayMax: 15_000,
      auth: (cb) => {
        void fetchSession(true).then((session) => cb({ token: session?.socketToken ?? '' }));
      },
    });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('driver.location', (event: DriverLocationEvent) => ref.current.onLocation?.(event));
    socket.on('ride.updated', (ride: { id: string; state: string }) => ref.current.onRide?.(ride));
    socket.on('alert.new', (alert: AdminAlertEvent) => ref.current.onAlert?.(alert));
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  return connected;
}
