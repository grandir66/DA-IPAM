/**
 * «Porta in DA-IPAM» una rete vista dal sensore trunk (27/10/2026, mini PC dimostrativo).
 *
 * Prima creava solo la rete. Ora: la rete, poi un giro ARP sul suo VID (col tag giusto, la sonda
 * usa `arp-scan` senza IP), si aspetta che finisca e che la sonda scriva, si legge il trunk e gli
 * host trovati entrano nella rete con IP, MAC, nome e produttore. Il giro è un di più: se la
 * sonda non c'è o non risponde, la rete entra lo stesso con gli host già osservati.
 */
import { createNetwork } from "@/lib/db";
import type { Network } from "@/types";
import { portaHostDalTrunk, type EsitoHostDalTrunk } from "@/lib/trunk/host-dal-trunk";
import { chiediGiroArp, scegliLettore, sincronizzaTrunk, trunkLetturaAttiva } from "@/lib/trunk/sensore-trunk";

export interface Dipendenze {
  giro: typeof chiediGiroArp;
  lettore: typeof scegliLettore;
  sincronizza: typeof sincronizzaTrunk;
  attesaMs: number;
  passoMs: number;
  /** La sonda scrive la rubrica ogni 5 s: dopo il giro se ne aspetta uno. */
  scritturaMs: number;
}

const PREDEFINITE: Dipendenze = {
  giro: chiediGiroArp, lettore: scegliLettore, sincronizza: sincronizzaTrunk,
  attesaMs: 90_000, passoMs: 3_000, scritturaMs: 6_000,
};

const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export interface EsitoAggiunta {
  rete: Network;
  host: EsitoHostDalTrunk;
  /** Com'è andato il giro ARP, in una frase. */
  giro: string;
}

export async function aggiungiReteDalTrunk(
  x: { vid: number; cidr: string; gateway?: string | null; nome?: string },
  dip: Partial<Dipendenze> = {},
): Promise<EsitoAggiunta> {
  const p = { ...PREDEFINITE, ...dip };
  const rete = createNetwork({
    cidr: x.cidr,
    name: x.nome?.trim() || (x.vid === 0 ? `VLAN nativa ${x.cidr}` : `VLAN ${x.vid}`),
    description: "Vista dal sensore trunk",
    gateway: x.gateway ?? null,
    vlan_id: x.vid || null,
  });
  let giro = "lettura del trunk spenta: niente giro ARP";
  if (trunkLetturaAttiva()) {
    try {
      await p.giro(x.vid, x.cidr);
      const l = await p.lettore();
      const fine = Date.now() + p.attesaMs;
      let finito = false;
      while (Date.now() < fine) {
        await pausa(p.passoMs);
        const s = await l.leggi<{ giro_in_corso?: boolean }>("/stato");
        if (!s.giro_in_corso) { finito = true; break; }
      }
      await pausa(p.scritturaMs);
      await p.sincronizza(l);
      giro = finito ? "giro ARP fatto" : `giro ARP ancora in corso dopo ${Math.round(p.attesaMs / 1000)} s: il resto arriva con le letture successive`;
    } catch (e) {
      giro = `giro ARP non fatto (${e instanceof Error ? e.message : String(e)}): host dalle osservazioni già lette`;
    }
  }
  return { rete, host: portaHostDalTrunk({ networkId: rete.id }), giro };
}
