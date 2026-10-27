/**
 * Le porte scritte dai giri pianificati (`cron/jobs.ts`) quando l'apparato ha un collector (decisione a di fine giro 2,
 * anticipo di C5). Con l'interruttore acceso, un collector per il prodotto e uno snapshot non in errore che ha scritto
 * le porte, il giro non riscrive le colonne che quel collector fornisce: continua a scrivere i MAC per porta e ciò che il
 * collector non legge. In ogni altro caso (interruttore spento, «classica» scelta, nessun collector, nessuno snapshot
 * usabile) il giro scrive come oggi: `upsertSwitchPorts`, riga intera.
 *
 * L'unione:
 * - porta del giro che ritrova una riga (per nome normalizzato, poi per indice fra le rimaste, come `proiettaPorte`):
 *   valori del giro, ma indice, nome e campi del collector restano quelli della riga;
 * - riga che il giro non ritrova: resta se il collector la conosce (l'elenco delle sue porte è suo), altrimenti va via
 *   come oggi;
 * - porta del giro che non ritrova nessuna riga: entra come oggi, se il suo indice è libero.
 */
import { collectorPossibili } from "@/lib/acquisition/riconosci";
import { campiDelCollectorPerPorta, nomePorta, type CampoPorta } from "@/lib/acquisition/proiezioni";
import {
  acquisizioneModulareAccesa, getCurrentTenantCode, getSwitchPortsByDevice, getTenantDb, sceltaFonteAcquisizione, ultimoSnapshotNonInErrore, upsertSwitchPorts,
} from "@/lib/db-tenant";
import type { NetworkDevice, SwitchPort } from "@/types";
import { leggiPayload } from "./archivio";
import { SCELTA_CLASSICA } from "./fonte";

export type PortaDelGiro = Omit<SwitchPort, "id" | "device_id" | "timestamp">;

/**
 * Per porta (nome normalizzato) i campi che il collector dell'apparato fornisce; null = nessun collector che governi le
 * porte, il giro scrive come oggi. Con l'interruttore spento non legge altro che l'interruttore.
 */
export function campiDelCollectorApparato(device: NetworkDevice): Map<string, CampoPorta[]> | null {
  if (!acquisizioneModulareAccesa()) return null;
  const scelta = sceltaFonteAcquisizione(device.id);
  if (scelta?.scelta === SCELTA_CLASSICA) return null;
  const possibili: string[] = collectorPossibili(device);
  const ammessi = scelta && possibili.includes(scelta.scelta) ? [scelta.scelta] : possibili;
  const riga = ultimoSnapshotNonInErrore(device.id, ammessi);
  if (!riga) return null;
  const letto = leggiPayload(device.id, riga.id);
  if (!letto.ok) {
    // Snapshot guasto: il giro scrive come oggi, e lo si dice (un guasto non diventa un «tutto bene» muto).
    console.warn(`[Acquisizione modulare] apparato #${device.id}: snapshot #${riga.id} non leggibile (${letto.motivo}), porte scritte dal giro`);
    return null;
  }
  const campi = campiDelCollectorPerPorta(letto.snapshot);
  return campi.size > 0 ? campi : null;
}

function senzaChiavi(r: SwitchPort): PortaDelGiro {
  const copia: Partial<SwitchPort> = { ...r };
  delete copia.id;
  delete copia.device_id;
  delete copia.timestamp;
  return copia as PortaDelGiro;
}

/** L'unione pura del giro con le righe di adesso (regole in testa al file). */
export function unisciPorteDelGiro(giro: readonly PortaDelGiro[], attuali: readonly SwitchPort[], campi: ReadonlyMap<string, readonly CampoPorta[]>): PortaDelGiro[] {
  const perNome = new Map(attuali.map((r) => [nomePorta(r.port_name), r]));
  const abbinate = new Map<PortaDelGiro, SwitchPort>();
  const prese = new Set<number>();
  for (const g of giro) {
    const r = perNome.get(nomePorta(g.port_name));
    if (r && !prese.has(r.port_index)) { abbinate.set(g, r); prese.add(r.port_index); }
  }
  const perIndice = new Map(attuali.filter((r) => !prese.has(r.port_index)).map((r) => [r.port_index, r]));
  for (const g of giro) {
    if (abbinate.has(g)) continue;
    const r = perIndice.get(g.port_index);
    if (r && !prese.has(r.port_index)) { abbinate.set(g, r); prese.add(r.port_index); }
  }

  const out: PortaDelGiro[] = [];
  const usati = new Set<number>();
  for (const [g, r] of abbinate) {
    const riga: PortaDelGiro = { ...g, port_index: r.port_index, port_name: r.port_name };
    const dalCollector = campi.get(nomePorta(r.port_name)) ?? [];
    const scrivibile = riga as unknown as Record<CampoPorta, unknown>;
    const attuale = r as unknown as Record<CampoPorta, unknown>;
    for (const c of dalCollector) scrivibile[c] = attuale[c] ?? null;
    out.push(riga);
    usati.add(r.port_index);
  }
  for (const r of attuali) {
    if (prese.has(r.port_index) || !campi.has(nomePorta(r.port_name))) continue;
    out.push(senzaChiavi(r));
    usati.add(r.port_index);
  }
  for (const g of giro) {
    if (abbinate.has(g) || usati.has(g.port_index)) continue;
    out.push(g);
    usati.add(g.port_index);
  }
  return out;
}

/** Il posto dei giri pianificati dove prima c'era `upsertSwitchPorts(device.id, ports)`. */
export function scriviPorteDelGiro(device: NetworkDevice, ports: PortaDelGiro[]): void {
  const campi = campiDelCollectorApparato(device);
  if (!campi) {
    upsertSwitchPorts(device.id, ports);
    return;
  }
  // Lettura delle righe e scrittura nella stessa transazione: un'acquisizione modulare che applica nel frattempo non
  // si perde a metà (`upsertSwitchPorts` apre la sua, qui annidata).
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Contesto tenant assente");
  const d = getTenantDb(code);
  d.transaction(() => upsertSwitchPorts(device.id, unisciPorteDelGiro(ports, getSwitchPortsByDevice(device.id), campi)))();
}
