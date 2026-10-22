/**
 * Applicazione di uno snapshot all'apparato (C2.5, tavola C1 decisione 2: l'acquisizione premuta dall'admin è l'atto
 * esplicito, niente secondo pulsante). Legge lo stato di adesso, chiede le modifiche alle proiezioni pure
 * (`acquisition/proiezioni`) e le scrive in UNA transazione: o tutto o niente, anche se il processo cade a metà.
 * Ogni modifica (e ogni valore a mano lasciato com'è) si registra in `acquisition_changes` con lo snapshot che l'ha
 * portata: la scheda la mostra («cosa è cambiato nell'apparato»). Ripetere lo stesso snapshot non cambia niente.
 *
 * Vicini e fatti di porta si scrivono con la fonte `collector`: li legge solo il modello per cavo; la mappa di oggi (T1)
 * e l'attribuzione leggono `device`/`unifi` e restano bit per bit (prova `applica.test.ts`).
 */
import { proietta, type Proiezione } from "@/lib/acquisition/proiezioni";
import { proiettaProxmox } from "@/lib/acquisition/proiezioni/proxmox";
import type { AcquisitionSnapshot } from "@/lib/acquisition";
import {
  chiaviViciniApparato, getCurrentTenantCode, getNetworkDeviceById, getTenantDb, hostPerProiezione, inserisciModificheAcquisizione, leggiVlanSwitchDb,
  portePerProiezione, scriviCampiIdentita, scriviFattiTopologia, scriviPortePerCampo, scriviVlanSwitch, syncInventoryFromDevice, updateNetworkDevice, upsertNeighbors,
  type ModificaAcquisizione, type VlanSwitchDb,
} from "@/lib/db-tenant";
import type { LetturaVlanSwitch } from "@/lib/devices/snmp-vlan";

export interface EsitoApplicazione {
  /** Modifiche scritte (campi, porte aggiunte o tolte, vicini nuovi). */
  scritte: number;
  /** Valori messi a mano lasciati com'erano. */
  manuali: number;
  ignorate: Proiezione["ignorate"];
  vicini: number;
  fatti: number;
}

const testo = (v: string | number | null | undefined): string | null => (v === null || v === undefined ? null : String(v));

/** La fotografia VLAN che c'è è già quella del collector con le stesse righe: niente da riscrivere. */
function stessaFotografiaVlan(c: VlanSwitchDb, l: LetturaVlanSwitch): boolean {
  if (c.lettura?.tabella !== "collector") return false;
  const ordina = (a: string[]) => JSON.stringify([...a].sort());
  return ordina(c.vlan.map((v) => `${v.vlan_id}|${v.nome ?? ""}`)) === ordina(l.vlan.map((v) => `${v.vlan_id}|${v.nome ?? ""}`))
    && ordina(c.porte.map((p) => `${p.vlan_id}|${p.if_index}|${p.untagged}`)) === ordina(l.porte.map((p) => `${p.vlan_id}|${p.if_index}|${p.untagged}`))
    && ordina(c.pvid.map((p) => `${p.if_index}|${p.pvid}`)) === ordina(l.pvid.map((p) => `${p.if_index}|${p.pvid}`));
}

export function applicaSnapshot(deviceId: number, snapshotId: number, snapshot: AcquisitionSnapshot, adesso: Date = new Date()): EsitoApplicazione {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Contesto tenant assente");
  const d = getTenantDb(code);
  const device = getNetworkDeviceById(deviceId);
  if (!device) throw new Error(`L'apparato #${deviceId} non esiste`);

  return d.transaction((): EsitoApplicazione => {
    const host = hostPerProiezione(deviceId);
    const p = proietta(snapshot, {
      identita: {
        apparato: { sysname: device.sysname, model: device.model, firmware: device.firmware, serial_number: device.serial_number, part_number: device.part_number },
        host: host ? { model: host.model, firmware: host.firmware, serial_number: host.serial_number } : null,
      },
      porte: portePerProiezione(deviceId),
    });
    const righe: ModificaAcquisizione[] = [];

    scriviCampiIdentita("network_devices", deviceId, p.identita.apparato);
    for (const m of p.identita.apparato) righe.push({ destinazione: "apparato", chiave: device.name, campo: m.campo, prima: m.prima, dopo: m.dopo, esito: "scritto" });
    if (host) {
      scriviCampiIdentita("hosts", host.id, p.identita.host);
      for (const m of p.identita.host) righe.push({ destinazione: "host", chiave: String(host.id), campo: m.campo, prima: m.prima, dopo: m.dopo, esito: "scritto" });
    }
    for (const c of p.identita.conflitti) righe.push({ destinazione: c.destinazione, chiave: String(host?.id ?? ""), campo: c.campo, prima: c.manuale, dopo: c.letto, esito: "manuale" });

    scriviPortePerCampo(deviceId, p.porte);
    for (const u of p.porte.aggiorna) {
      for (const [campo, dopo] of Object.entries(u.campi)) righe.push({ destinazione: "porte", chiave: u.port_name, campo, prima: testo(u.prima[campo as keyof typeof u.prima]), dopo: testo(dopo), esito: "scritto" });
    }
    for (const a of p.porte.aggiungi) righe.push({ destinazione: "porte", chiave: a.port_name, campo: "porta", prima: null, dopo: a.port_name, esito: "aggiunta" });
    for (const t of p.porte.togli) righe.push({ destinazione: "porte", chiave: t.port_name, campo: "porta", prima: t.port_name, dopo: null, esito: "tolta" });

    let vicini = 0;
    if (p.vicini) {
      const gia = chiaviViciniApparato(deviceId);
      upsertNeighbors(deviceId, p.vicini, "collector");
      vicini = p.vicini.length;
      for (const n of p.vicini) {
        if (!gia.has(`${n.localPort}\u0000${n.remoteDevice}\u0000${n.remotePort}`)) {
          righe.push({ destinazione: "vicini", chiave: n.localPort, campo: "vicino", prima: null, dopo: `${n.remoteDevice} · ${n.remotePort}`, esito: "aggiunta" });
        }
      }
    }
    let fatti = 0;
    if (p.fatti) fatti = scriviFattiTopologia(deviceId, "collector", { porte: p.fatti, bridge: [], macs: [] }, adesso)?.porte ?? 0;

    // VLAN della scheda (Comware via SSH, 70151 22/10): la fotografia si sostituisce solo se cambia.
    if (p.vlan) {
      const prima = leggiVlanSwitchDb(deviceId);
      if (!stessaFotografiaVlan(prima, p.vlan) && scriviVlanSwitch(deviceId, p.vlan, adesso)) {
        const taggate = p.vlan.porte.filter((x) => x.untagged === false).length;
        righe.push({
          destinazione: "vlan", chiave: device.name, campo: "VLAN",
          prima: prima.lettura ? `${prima.vlan.length} VLAN (${prima.lettura.tabella})` : null,
          dopo: `${p.vlan.vlan.length} VLAN, ${taggate} porte taggate`, esito: "scritto",
        });
      }
    }

    // Proxmox: nodi e VM nello stesso `last_proxmox_scan_result` della scansione di oggi, poi l'inventario come fa lei.
    // Solo per lo snapshot del collector `proxmox-ve` (gli altri collector non toccano queste colonne).
    const proxmox = proiettaProxmox(snapshot, device.last_proxmox_scan_result ?? null);
    if (proxmox) {
      const risultato = JSON.stringify(proxmox);
      if (risultato !== device.last_proxmox_scan_result) {
        updateNetworkDevice(deviceId, { last_proxmox_scan_at: proxmox.scanned_at, last_proxmox_scan_result: risultato });
        syncInventoryFromDevice({ ...device, last_proxmox_scan_at: proxmox.scanned_at, last_proxmox_scan_result: risultato });
        righe.push({ destinazione: "inventario", chiave: device.name, campo: "nodi e VM", prima: null, dopo: `${proxmox.hosts.length} nodi, ${proxmox.vms.length} VM`, esito: "scritto" });
      }
    }

    inserisciModificheAcquisizione(snapshotId, deviceId, righe);
    return {
      scritte: righe.filter((r) => r.esito !== "manuale").length,
      manuali: righe.filter((r) => r.esito === "manuale").length,
      ignorate: p.ignorate,
      vicini,
      fatti,
    };
  })();
}
