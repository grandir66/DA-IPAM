/**
 * Giro della matrice di segmentazione: per ogni VLAN sorgente sceglie i servizi
 * già noti delle altre reti e chiede alla sonda di provarli da dentro quella VLAN.
 */
import { withTenant, getTenantDb } from "@/lib/db-tenant";
import { sorgentiConBersagli } from "./bersagli";
import { apriGiro, chiudiGiro, salvaProve } from "./db";
import {
  chiediRaggiungibilita,
  leggiRaggiungibilita,
  SensoreTrunkAssente,
  type GiroRaggiungibilita,
} from "@/lib/trunk/sensore-trunk";

export interface StatoGiroSeg {
  inCorso: boolean;
  iniziato: string | null;
  finito: string | null;
  errore: string | null;
  fatte: number;
  totale: number;
}

const g = globalThis as typeof globalThis & { __giriSegmentazione?: Map<string, StatoGiroSeg> };
const giri = (g.__giriSegmentazione ??= new Map<string, StatoGiroSeg>());

export function statoGiroSeg(tenant: string): StatoGiroSeg {
  return giri.get(tenant) ?? { inCorso: false, iniziato: null, finito: null, errore: null, fatte: 0, totale: 0 };
}

export interface ClientRaggiungibilita {
  avvia: (
    vid: number,
    cidr: string,
    gateway: string,
    bersagli: Array<{ ip: string; porta: number }>,
    protocollo: string,
  ) => Promise<{ id: number; fonte: "socket" | "edge" }>;
  leggi: (id: number, fonte: "socket" | "edge") => Promise<GiroRaggiungibilita>;
}

const CLIENT: ClientRaggiungibilita = { avvia: chiediRaggiungibilita, leggi: leggiRaggiungibilita };

async function attendi(client: ClientRaggiungibilita, id: number, fonte: "socket" | "edge"): Promise<GiroRaggiungibilita> {
  for (let i = 0; i < 180; i++) {
    const r = await client.leggi(id, fonte);
    if (r.fine) return r;
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error("la sonda non ha finito in tempo");
}

export function avviaGiroSeg(
  tenant: string,
  client?: ClientRaggiungibilita,
  opzioni: { sourceNetworkId?: number; retiBersaglio?: number[]; protocollo?: string } = {},
): boolean {
  if (giri.get(tenant)?.inCorso) return false;
  const sonda = client ?? CLIENT;
  const stato: StatoGiroSeg = { inCorso: true, iniziato: new Date().toISOString(), finito: null, errore: null, fatte: 0, totale: 0 };
  giri.set(tenant, stato);
  void withTenant(tenant, async () => {
    const db = getTenantDb(tenant);
    const gid = apriGiro(db);
    try {
      let sorgenti = sorgentiConBersagli(db).filter((s) => s.bersagli.length > 0);
      if (opzioni.sourceNetworkId != null) {
        sorgenti = sorgenti.filter((s) => s.rete_id === opzioni.sourceNetworkId);
      }
      if (opzioni.retiBersaglio?.length) {
        const ok = new Set(opzioni.retiBersaglio);
        sorgenti = sorgenti
          .map((s) => ({ ...s, bersagli: s.bersagli.filter((b) => ok.has(b.rete_bersaglio)) }))
          .filter((s) => s.bersagli.length > 0);
      }
      stato.totale = sorgenti.length;
      if (sorgenti.length === 0) {
        chiudiGiro(db, gid, "ok");
        return;
      }
      for (const s of sorgenti) {
        const avvio = await sonda.avvia(
          s.vlan,
          s.cidr,
          s.gateway,
          s.bersagli.map((b) => ({ ip: b.ip, porta: b.porta })),
          opzioni.protocollo ?? "direct",
        );
        const fatto = await attendi(sonda, avvio.id, avvio.fonte);
        if (fatto.esito !== "ok") throw new Error(fatto.errore || "giro della sonda fallito");
        const chiave = new Map(s.bersagli.map((b) => [`${b.ip}:${b.porta}`, b]));
        salvaProve(
          db,
          gid,
          s.vlan,
          s.rete_id,
          fatto.esiti.map((e) => {
            const noto = chiave.get(`${e.ip}:${e.porta}`);
            return {
              rete_bersaglio: noto?.rete_bersaglio ?? null,
              host_id: noto?.host_id ?? null,
              ip: e.ip,
              porta: e.porta,
              esito: e.esito,
            };
          }),
        );
        stato.fatte += 1;
      }
      chiudiGiro(db, gid, "ok");
    } catch (e) {
      const msg = e instanceof SensoreTrunkAssente
        ? "sonda trunk assente o da aggiornare"
        : e instanceof Error ? e.message : String(e);
      stato.errore = msg;
      chiudiGiro(db, gid, "errore", msg);
      console.error(`[segmentazione] giro fallito per ${tenant}:`, e);
    } finally {
      stato.inCorso = false;
      stato.finito = new Date().toISOString();
    }
  });
  return true;
}
