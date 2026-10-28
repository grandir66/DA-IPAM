/**
 * Lettura e creazione delle reti del trunk per il wizard (28/10). Solo server,
 * dentro il contesto del tenant. La logica di scelta sta in `reti-trunk.ts`.
 *
 * Lettura: se la sonda c'è sulla VM la lettura si accende qui (un'appliance
 * appena installata arriva al wizard prima del primo giro di 2 minuti), e se
 * non c'è ancora niente o il tecnico preme «Rileggi il trunk» si legge subito,
 * con un tempo massimo: il wizard non deve restare appeso alla sonda.
 */
import { getActiveTenants } from "@/lib/db-hub";
import { getNetworks } from "@/lib/db";
import { NetworkCreateSchema } from "@/lib/validators";
import { creaRete } from "@/lib/networks/salva-rete";
import { portaHostDalTrunk, type EsitoHostDalTrunk } from "@/lib/trunk/host-dal-trunk";
import {
  accendiLetturaSeSondaLocale,
  getTrunkMatrice,
  sincronizzaTrunk,
  trunkLetturaAttiva,
  trunkRiepilogo,
} from "@/lib/trunk/sensore-trunk";
import type { ReteEsistente, ReteTrunkVista, SceltaTrunk } from "./reti-trunk";

const ATTESA_LETTURA_MS = 12_000;

export interface RetiTrunkWizard {
  /** La lettura del sensore è accesa per questo cliente. */
  attiva: boolean;
  /** Ultima lettura riuscita (ISO), null = mai. */
  aggiornato: string | null;
  vlan: number;
  /** Com'è andata la lettura fatta ora, se non è andata: una frase. */
  nota: string | null;
  reti: ReteTrunkVista[];
  esistenti: ReteEsistente[];
}

async function leggiConLimite(): Promise<string | null> {
  const scaduto = new Promise<string>((ok) => {
    setTimeout(() => ok("la sonda non ha risposto in tempo: riprova fra poco"), ATTESA_LETTURA_MS).unref?.();
  });
  try {
    const esito = await Promise.race([sincronizzaTrunk().then((e) => e.nota ?? null), scaduto]);
    return esito;
  } catch (e) {
    return `sonda non letta: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function leggiRetiTrunk(rileggi: boolean): Promise<RetiTrunkWizard> {
  accendiLetturaSeSondaLocale(getActiveTenants().length);
  const attiva = trunkLetturaAttiva();
  let nota: string | null = null;
  if (attiva && (rileggi || trunkRiepilogo().vlan === 0)) nota = await leggiConLimite();
  const r = trunkRiepilogo();
  const reti: ReteTrunkVista[] = attiva
    ? getTrunkMatrice(1).reti.map((x) => ({
        vid: x.vid, cidr: x.cidr, gateway_ip: x.gateway_ip, maschera: x.maschera, dispositivi: x.ip.length,
      }))
    : [];
  const esistenti: ReteEsistente[] = getNetworks().map((n) => ({ id: n.id, name: n.name, cidr: n.cidr }));
  return { attiva, aggiornato: r.aggiornato, vlan: r.vlan, nota, reti, esistenti };
}

export interface EsitoRetiTrunk {
  esiti: Array<{ cidr: string; vid: number; id: number | null; errore: string | null }>;
  host: EsitoHostDalTrunk;
}

/**
 * Crea le reti scelte, una per una: una che non va (sovrapposta a una rete
 * nata nel frattempo) non ferma le altre e torna col suo errore. Router, DNS e
 * credenziali sono quelli della rete nativa del wizard. Poi gli host già visti
 * sul trunk entrano nelle reti create (IP, MAC, nome, produttore).
 */
export function creaRetiTrunk(
  scelte: readonly SceltaTrunk[],
  comuni: { routerId: number | null; credentialIds: number[]; dns: string | null },
): EsitoRetiTrunk {
  const esiti: EsitoRetiTrunk["esiti"] = [];
  const host: EsitoHostDalTrunk = { creati: 0, mac: 0 };
  for (const s of scelte) {
    try {
      const letti = NetworkCreateSchema.safeParse({
        name: s.nome.trim(),
        cidr: s.cidr.trim(),
        description: "Vista dal sensore trunk",
        gateway: s.gateway.trim(),
        vlan_id: s.vid || null,
        dns_server: comuni.dns || null,
        router_id: comuni.routerId,
        credential_ids: comuni.credentialIds.length > 0 ? comuni.credentialIds : undefined,
      });
      if (!letti.success) throw new Error(letti.error.issues[0]?.message ?? "dati della rete non validi");
      const rete = creaRete(letti.data);
      esiti.push({ cidr: rete.cidr, vid: s.vid, id: rete.id, errore: null });
      try {
        const h = portaHostDalTrunk({ networkId: rete.id });
        host.creati += h.creati;
        host.mac += h.mac;
      } catch (e) {
        console.warn(`[onboarding] host dal trunk non portati in ${rete.cidr}:`, e);
      }
    } catch (e) {
      const messaggio = e instanceof Error ? e.message : String(e);
      esiti.push({ cidr: s.cidr, vid: s.vid, id: null, errore: messaggio.includes("UNIQUE") ? "rete già esistente" : messaggio });
    }
  }
  return { esiti, host };
}
