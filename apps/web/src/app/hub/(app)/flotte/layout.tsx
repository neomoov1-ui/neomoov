import { FleetOrgProvider } from '@/components/hub/fleet-org';

/** Pages Flotte de My Hub (étape 23) : toutes travaillent sur l'organisation choisie, par les routes `/v1/org/:id/...`. */
export default function FleetLayout({ children }: { children: React.ReactNode }) {
  return <FleetOrgProvider>{children}</FleetOrgProvider>;
}
