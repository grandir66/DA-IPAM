/**
 * Proiezioni (piano 2026-10-21 §3, C2.1): dallo snapshot 1.0 alle modifiche dell'inventario, una funzione pura per
 * destinazione. Nessun DB: chi applica (`acquisizione-modulare/applica.ts`) passa lo stato di adesso e scrive il
 * risultato in una transazione. Regole dell'arricchimento coerente, uguali per tutte:
 *
 * - un valore entra solo da una sezione `ok` o `partial` e solo se non è `null` (nello snapshot `null` = ignoto);
 * - una lista si toglie solo da una sezione `ok`: da `partial` si aggiunge o si aggiorna, mai si toglie;
 * - nelle modifiche un campo ASSENTE = resta com'è, `null` = letto e vuoto (solo da una sezione `ok` che dice
 *   «la porta non ha questo»: niente PoE, nessun vicino);
 * - il manuale vince: un valore che non viene da una lettura automatica non si sovrascrive (conflitto detto).
 *
 * Destinazioni (tabella del §3, decisione D4): `identity` → apparato (e i campi dell'host che ne derivano);
 * `interfaces`, `vlans` (PVID), `poe`, `spanning_tree`, `neighbors` → `switch_ports` per campo; `neighbors` → vicini
 * con fonte `collector`; `spanning_tree` (solo CIST) e `aggregation` → fatti di porta con fonte `collector`.
 * `vlans` con stato `ok` → le tabelle VLAN della scheda (`switch_vlan*`, fonte «collector»: taggate e non taggate per porta).
 * `forwarding`, `network` e il resto restano nello snapshot.
 *
 * Le porte «da switch» (`switch_ports`, fatti di porta) si proiettano solo per le famiglie switch e router del catalogo
 * (`ricevePorteDaSwitch`): le interfacce di un NAS, di un server, di un hypervisor, di un controller o di un access point
 * restano nello snapshot e non diventano porte di uno switch.
 */
import { ricevePorteDaSwitch } from "../catalogo";
import type { LetturaVlanSwitch } from "@/lib/devices/snmp-vlan";
import type { AcquisitionSnapshot, DeviceInterface } from "../schema";

export type StatoSezione = "ok" | "partial" | "unsupported" | "error" | "skipped";

/** Sezione usabile per scrivere: `ok` o `partial`. */
const usabile = (s: { status: StatoSezione } | undefined): boolean => s?.status === "ok" || s?.status === "partial";

export interface SezioneIgnorata { sezione: string; stato: StatoSezione; destinazione: string }

// ── Identità ────────────────────────────────────────────────────────────────

export const CAMPI_IDENTITA = ["sysname", "model", "firmware", "serial_number", "part_number"] as const;
export type CampoIdentita = (typeof CAMPI_IDENTITA)[number];
/** Campi che l'host riceve dall'apparato (come `syncDeviceToHost`, senza mai coprire un valore messo a mano). */
export const CAMPI_HOST = ["model", "firmware", "serial_number"] as const;
export type CampoHost = (typeof CAMPI_HOST)[number];

export interface StatoIdentita {
  apparato: Record<CampoIdentita, string | null>;
  /** L'host abbinato, se c'è: i suoi valori di adesso. */
  host: Record<CampoHost, string | null> | null;
}

export interface ModificaCampo<C extends string> { campo: C; prima: string | null; dopo: string }
export interface ConflittoManuale { destinazione: "host"; campo: string; manuale: string; letto: string }

export interface ModificheIdentita {
  apparato: ModificaCampo<CampoIdentita>[];
  host: ModificaCampo<CampoHost>[];
  conflitti: ConflittoManuale[];
}

const pieno = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

export function proiettaIdentita(snapshot: AcquisitionSnapshot, stato: StatoIdentita): ModificheIdentita {
  const out: ModificheIdentita = { apparato: [], host: [], conflitti: [] };
  const id = snapshot.identity.data;
  if (!usabile(snapshot.identity) || !id) return out;
  const letti: Record<CampoIdentita, string | null> = {
    sysname: id.hostname, model: id.model, firmware: id.firmware, serial_number: id.serial_number, part_number: id.part_number ?? null,
  };
  for (const campo of CAMPI_IDENTITA) {
    const v = letti[campo];
    if (!pieno(v) || v === stato.apparato[campo]) continue;
    out.apparato.push({ campo, prima: stato.apparato[campo], dopo: v });
  }
  if (stato.host) {
    for (const campo of CAMPI_HOST) {
      const v = letti[campo];
      const h = stato.host[campo];
      if (!pieno(v) || v === h) continue;
      // Sull'host un valore diverso da quello che l'apparato aveva (e quindi gli aveva copiato) è stato messo da
      // qualcun altro, di solito a mano dalla tab Gestione: resta, e la differenza si dice.
      if (pieno(h) && h !== stato.apparato[campo]) out.conflitti.push({ destinazione: "host", campo, manuale: h, letto: v });
      else out.host.push({ campo, prima: h, dopo: v });
    }
  }
  return out;
}

// ── Porte (switch_ports per campo, scoperta 5) ──────────────────────────────

export const CAMPI_PORTA = ["status", "speed", "duplex", "vlan", "poe_status", "poe_power_mw", "stp_state", "trunk_neighbor_name", "trunk_neighbor_port"] as const;
export type CampoPorta = (typeof CAMPI_PORTA)[number];
export type ValoriPorta = Partial<Record<CampoPorta, string | number | null>>;

export interface PortaAttuale extends Record<CampoPorta, string | number | null> { port_index: number; port_name: string }

export interface ModifichePorte {
  aggiorna: Array<{ port_index: number; port_name: string; campi: ValoriPorta; prima: ValoriPorta }>;
  aggiungi: Array<{ port_index: number; port_name: string; campi: ValoriPorta }>;
  /** Solo da `interfaces` con stato `ok`: porte di adesso che nessuna interfaccia letta ritrova. */
  togli: Array<{ port_index: number; port_name: string }>;
}

export const nomePorta = (nome: string): string => nome.replace(/\s+/g, "").toLowerCase();

const CIST = new Set(["", "0", "cist", "mst0", "common"]);
const eCist = (istanza: string | null): boolean => CIST.has((istanza ?? "").trim().toLowerCase());

function valoriPerPorta(snapshot: AcquisitionSnapshot, i: DeviceInterface): ValoriPorta {
  const v: ValoriPorta = {};
  if (usabile(snapshot.interfaces)) {
    const admin = i.admin_status?.toLowerCase() ?? null;
    const oper = i.oper_status?.toLowerCase() ?? null;
    if (admin === "down" || admin === "disabled") v.status = "disabled";
    else if (oper === "up" || oper === "down") v.status = oper;
    if (i.speed_bps !== null) v.speed = i.speed_bps > 0 ? `${Math.round(i.speed_bps / 1e6)} Mbps` : null;
    const duplex = i.duplex?.toLowerCase() ?? null;
    if (duplex && /full|half/.test(duplex)) v.duplex = duplex.includes("full") ? "full" : "half";
    if (i.pvid !== null) v.vlan = i.pvid;
  }
  if (usabile(snapshot.poe)) {
    const p = snapshot.poe.data.find((x) => nomePorta(x.port) === nomePorta(i.name));
    if (p) {
      const stato = p.status ?? (p.enabled === false ? "disabled" : null);
      if (stato !== null) v.poe_status = stato.toLowerCase();
      if (p.power_watts !== null) v.poe_power_mw = Math.round(p.power_watts * 1000);
    } else if (snapshot.poe.status === "ok" && i.kind === "physical") {
      v.poe_status = null;
      v.poe_power_mw = null;
    }
  }
  if (usabile(snapshot.spanning_tree)) {
    const s = snapshot.spanning_tree.data.ports.find((x) => eCist(x.instance) && nomePorta(x.port) === nomePorta(i.name));
    if (s?.state) v.stp_state = s.state.toLowerCase();
  }
  if (usabile(snapshot.neighbors)) {
    const n = snapshot.neighbors.data.find((x) => nomePorta(x.local_port) === nomePorta(i.name));
    if (n) {
      v.trunk_neighbor_name = n.system_name ?? n.remote_chassis;
      v.trunk_neighbor_port = n.remote_port || null;
    } else if (snapshot.neighbors.status === "ok") {
      v.trunk_neighbor_name = null;
      v.trunk_neighbor_port = null;
    }
  }
  return v;
}

export function proiettaPorte(snapshot: AcquisitionSnapshot, attuali: readonly PortaAttuale[]): ModifichePorte {
  const out: ModifichePorte = { aggiorna: [], aggiungi: [], togli: [] };
  if (!ricevePorteDaSwitch(snapshot.collector) || !usabile(snapshot.interfaces)) return out;
  const tutte = snapshot.interfaces.data;
  // Abbinamento in due passate. Prima il nome: il percorso SSH di sempre numera le porte per posizione nell'uscita, mentre
  // il collector porta l'ifIndex SNMP, quindi lo stesso numero può essere un'altra porta. Poi l'indice, solo fra righe e
  // interfacce che nessun nome ha abbinato (stessa porta scritta dall'SNMP con un nome diverso, «Ten-GigabitEthernet1/0/1»
  // contro «XGE1/0/1»).
  const perNome = new Map(attuali.map((p) => [nomePorta(p.port_name), p]));
  const abbinate = new Map<DeviceInterface, PortaAttuale>();
  const trovate = new Set<number>();
  for (const i of tutte) {
    const p = perNome.get(nomePorta(i.name));
    if (p && !trovate.has(p.port_index)) { abbinate.set(i, p); trovate.add(p.port_index); }
  }
  const perIndice = new Map(attuali.filter((p) => !trovate.has(p.port_index)).map((p) => [p.port_index, p]));
  for (const i of tutte) {
    if (abbinate.has(i) || i.if_index === null) continue;
    const p = perIndice.get(i.if_index);
    if (p && !trovate.has(p.port_index)) { abbinate.set(i, p); trovate.add(p.port_index); }
  }
  const usati = new Set(attuali.map((p) => p.port_index));
  let prossimo = Math.max(0, ...attuali.map((p) => p.port_index), ...tutte.map((i) => i.if_index ?? 0)) + 1;
  for (const i of tutte) {
    const esistente = abbinate.get(i);
    if (i.kind === "other") continue;
    const campi = valoriPerPorta(snapshot, i);
    if (esistente) {
      const cambiati: ValoriPorta = {};
      const prima: ValoriPorta = {};
      for (const c of CAMPI_PORTA) {
        if (!(c in campi)) continue;
        const nuovo = campi[c] ?? null;
        if (nuovo === (esistente[c] ?? null)) continue;
        cambiati[c] = nuovo;
        prima[c] = esistente[c] ?? null;
      }
      if (Object.keys(cambiati).length > 0) out.aggiorna.push({ port_index: esistente.port_index, port_name: esistente.port_name, campi: cambiati, prima });
      continue;
    }
    const numerico = /^\d+$/.test(i.name) ? Number(i.name) : null;
    let indice = i.if_index ?? numerico;
    if (indice === null || usati.has(indice)) indice = prossimo++;
    usati.add(indice);
    out.aggiungi.push({ port_index: indice, port_name: i.name, campi });
  }
  if (snapshot.interfaces.status === "ok") {
    for (const p of attuali) if (!trovate.has(p.port_index)) out.togli.push({ port_index: p.port_index, port_name: p.port_name });
  }
  return out;
}

/**
 * Per ogni porta che il collector legge (per nome normalizzato), i campi di `switch_ports` che la proiezione scrive da
 * questo snapshot: gli stessi di `proiettaPorte`, dalle stesse regole. Serve ai giri pianificati (decisione a di fine
 * giro 2) per non riscrivere quei campi. Vuota se `interfaces` non è usabile: allora il collector non scrive porte.
 */
export function campiDelCollectorPerPorta(snapshot: AcquisitionSnapshot): Map<string, CampoPorta[]> {
  const out = new Map<string, CampoPorta[]>();
  if (!ricevePorteDaSwitch(snapshot.collector) || !usabile(snapshot.interfaces)) return out;
  for (const i of snapshot.interfaces.data) {
    if (i.kind === "other") continue;
    const v = valoriPerPorta(snapshot, i);
    out.set(nomePorta(i.name), CAMPI_PORTA.filter((c) => c in v));
  }
  return out;
}

// ── Vicini (fonte `collector`, letta solo dal modello per cavo) ─────────────

export interface VicinoProiettato {
  localPort: string;
  remoteDevice: string;
  remotePort: string;
  protocol: "lldp";
  remoteIp?: string;
  remoteMac?: string;
  remotePlatform?: string;
  discoveredBy: string;
  remoteCaps: string | null;
}

const MAC = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}$/i;

/** null = sezione non usabile (nessuna scrittura). Da `partial` si aggiungono e si aggiornano: i vicini non si tolgono mai qui. */
export function proiettaVicini(snapshot: AcquisitionSnapshot): VicinoProiettato[] | null {
  if (!usabile(snapshot.neighbors)) return null;
  return snapshot.neighbors.data.map((n) => ({
    localPort: n.local_port,
    remoteDevice: n.system_name ?? n.remote_chassis,
    remotePort: n.remote_port,
    protocol: "lldp",
    ...(n.management_addresses[0] ? { remoteIp: n.management_addresses[0] } : {}),
    ...(MAC.test(n.remote_chassis) ? { remoteMac: n.remote_chassis } : {}),
    ...(n.system_description ? { remotePlatform: n.system_description } : {}),
    discoveredBy: "lldp",
    remoteCaps: n.capabilities.length ? n.capabilities.map((c) => c.toLowerCase()).join(",") : null,
  }));
}

// ── Fatti di porta (fonte `collector`, solo istanza 0/CIST) ─────────────────

export interface FattoPortaProiettato {
  port_key: string;
  port_name: string;
  port_index: number | null;
  if_kind: string | null;
  running: number | null;
  lag_group: string | null;
  stp_role: string | null;
  stp_state: string | null;
}

/** Per le prime quattro lettere: Comware scrive ROOT/DESI/ALTE/BACK, gli altri la parola intera. */
const RUOLI: Record<string, string> = { root: "root", desi: "designated", alte: "alternate", back: "backup", disa: "disabled" };
const STATI: Record<string, string> = { forwarding: "forwarding", discarding: "discarding", blocking: "discarding", listening: "discarding", learning: "learning", disabled: "disabled" };

/** null = né spanning tree né aggregazioni usabili. Ogni riga porta tutte le colonne (null dove non si sa), come vuole il contratto dei lettori. */
export function proiettaFatti(snapshot: AcquisitionSnapshot): FattoPortaProiettato[] | null {
  const stp = usabile(snapshot.spanning_tree), lag = usabile(snapshot.aggregation);
  if (!ricevePorteDaSwitch(snapshot.collector) || !stp && !lag || !usabile(snapshot.interfaces)) return null;
  const gruppo = new Map<string, string>();
  if (lag) for (const a of snapshot.aggregation.data) for (const m of a.members) gruppo.set(nomePorta(m), a.name);
  return snapshot.interfaces.data.filter((i) => i.kind !== "other").map((i) => {
    const s = stp ? snapshot.spanning_tree.data.ports.find((x) => eCist(x.instance) && nomePorta(x.port) === nomePorta(i.name)) : undefined;
    const oper = i.oper_status?.toLowerCase();
    return {
      port_key: i.if_index !== null ? `i:${i.if_index}` : `n:${nomePorta(i.name)}`,
      port_name: i.name,
      port_index: i.if_index,
      if_kind: i.kind === "aggregate" ? "lag" : "physical",
      running: oper === "up" ? 1 : oper === "down" ? 0 : null,
      lag_group: lag ? (gruppo.get(nomePorta(i.name)) ?? null) : null,
      stp_role: s?.role ? (RUOLI[s.role.toLowerCase().slice(0, 4)] ?? null) : null,
      stp_state: s?.state ? (STATI[s.state.toLowerCase()] ?? null) : null,
    };
  });
}

// ── VLAN della scheda (switch_vlan*, fonte «collector») ─────────────────────

/**
 * Le VLAN dello switch come le scrive la lettura SNMP (`scriviVlanSwitch`), dalla sezione `vlans` del collector: è una
 * fotografia che sostituisce la precedente, quindi solo da `ok` (un `partial`, per esempio con gli intervalli di porte di
 * Comware, non scrive). Porte per nome → ifIndex delle interfacce dello snapshot; quelle senza ifIndex si contano in
 * `porte_senza_mappa`. A 70151 (22/10) i Comware IRF rispondono tooBig a ogni riga Q-BRIDGE delle porte: via SSH
 * `display vlan all` le dà tutte (29 VLAN, ~2800 porte taggate).
 */
export function proiettaVlan(snapshot: AcquisitionSnapshot): LetturaVlanSwitch | null {
  if (!ricevePorteDaSwitch(snapshot.collector) || snapshot.vlans.status !== "ok" || snapshot.vlans.data.length === 0) return null;
  const indice = new Map<string, number>();
  for (const i of snapshot.interfaces.data) if (i.if_index !== null) indice.set(nomePorta(i.name), i.if_index);
  const porte = new Map<string, LetturaVlanSwitch["porte"][number]>();
  const senzaMappa = new Set<string>();
  for (const v of snapshot.vlans.data) {
    // Prima le taggate, poi le non taggate: una porta scritta in tutte e due resta U.
    for (const [lista, untagged] of [[v.tagged_ports, false], [v.untagged_ports, true]] as const) {
      for (const nome of lista) {
        const ifIndex = indice.get(nomePorta(nome));
        if (ifIndex === undefined) { senzaMappa.add(nomePorta(nome)); continue; }
        porte.set(`${v.id}|${ifIndex}`, { vlan_id: v.id, if_index: ifIndex, egress: true, untagged });
      }
    }
  }
  const pvid = snapshot.interfaces.data
    .filter((i): i is DeviceInterface & { if_index: number; pvid: number } => i.if_index !== null && i.pvid !== null)
    .map((i) => ({ if_index: i.if_index, pvid: i.pvid }));
  return {
    vlan: snapshot.vlans.data.map((v) => ({ vlan_id: v.id, nome: v.name })),
    porte: [...porte.values()],
    pvid,
    tabella: "collector", mappa_porte: "ifindex", ordine_bit: "standard", porte_senza_mappa: senzaMappa.size,
    letture: 1, riuscite: 1, codice: null, codici: {}, esito: "letto",
  };
}

// ── Insieme ─────────────────────────────────────────────────────────────────

export interface Proiezione {
  identita: ModificheIdentita;
  porte: ModifichePorte;
  vicini: VicinoProiettato[] | null;
  fatti: FattoPortaProiettato[] | null;
  /** null = niente da scrivere nelle tabelle VLAN (sezione non `ok`, vuota, o collector che non dà porte da switch). */
  vlan: LetturaVlanSwitch | null;
  ignorate: SezioneIgnorata[];
}

const DESTINAZIONI: Array<[keyof AcquisitionSnapshot, string]> = [
  ["identity", "apparato"], ["interfaces", "porte"], ["poe", "porte"], ["spanning_tree", "porte e fatti"], ["neighbors", "vicini"], ["aggregation", "fatti"],
];

export function proietta(snapshot: AcquisitionSnapshot, stato: { identita: StatoIdentita; porte: readonly PortaAttuale[] }): Proiezione {
  const ignorate: SezioneIgnorata[] = [];
  for (const [sezione, destinazione] of DESTINAZIONI) {
    const s = snapshot[sezione] as { status: StatoSezione } | undefined;
    if (s && !usabile(s)) ignorate.push({ sezione, stato: s.status, destinazione });
  }
  return {
    identita: proiettaIdentita(snapshot, stato.identita),
    porte: proiettaPorte(snapshot, stato.porte),
    vicini: proiettaVicini(snapshot),
    fatti: proiettaFatti(snapshot),
    vlan: proiettaVlan(snapshot),
    ignorate,
  };
}
