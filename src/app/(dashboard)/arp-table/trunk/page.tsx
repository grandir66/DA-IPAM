import { getServerTenantCode } from "@/lib/api-tenant";
import { withTenant } from "@/lib/db-tenant";
import { getNetworks } from "@/lib/db";
import { getTrunkAppartenenza, getTrunkMatrice, getTrunkOsservazioniPaginated, getTrunkVlan, getTrunkUltimoEsito, getTrunkVlanProtocolli, statoSonda, trunkLetturaAttiva, trunkRiepilogo } from "@/lib/trunk/sensore-trunk";
import { getRiepilogoRilievi, getRilieviPaginated } from "@/lib/trunk/rilievi";
import { puntiAscolto, type PuntoAscolto } from "@/lib/traffico/reti-collector";
import { auth } from "@/lib/auth";
import { TrunkClient } from "./trunk-client";

export default async function TrunkPage() {
  const tenantCode = await getServerTenantCode();
  const dati = withTenant(tenantCode, () => {
    const rilievi = getRilieviPaginated({ limit: 50 });
    return {
      attiva: trunkLetturaAttiva(),
      vlan: getTrunkVlan(),
      matrice: getTrunkMatrice(14),
      riepilogo: trunkRiepilogo(),
      vlanProtocolli: getTrunkVlanProtocolli(),
      ...getTrunkOsservazioniPaginated({ limit: 100 }),
      appartenenza: getTrunkAppartenenza(),
      retiIpam: getNetworks().map((n) => n.cidr),
      ultimoEsito: getTrunkUltimoEsito(),
      rilievi: { rilievi: rilievi.righe, totale: rilievi.totale, riepilogo: getRiepilogoRilievi() },
    };
  });
  // Un guasto dei collector non deve togliere la pagina del trunk.
  let punti: PuntoAscolto[] = [];
  try {
    punti = withTenant(tenantCode, () => puntiAscolto());
  } catch (e) {
    console.error("[trunk] punti di ascolto:", e instanceof Error ? e.message : e);
  }
  const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  // Lo stato vero della sonda, chiesto adesso (pochi secondi al massimo): non basta l'interruttore in Opzioni.
  const sonda = await withTenant(tenantCode, () => statoSonda());
  return (
    <div className="space-y-4">
      <h1 className="sr-only">Reti dal trunk</h1>
      <TrunkClient iniziale={{ ...dati, sonda, punti }} admin={ruolo === "admin" || ruolo === "superadmin"} />
    </div>
  );
}
