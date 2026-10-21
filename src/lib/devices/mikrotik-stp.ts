/**
 * Spanning tree, bridge, istanze MSTP, fasci e interfacce di un MikroTik (spec topologia §13.5.2, MK2-MK8) in fatti con le parole
 * dello standard (ruoli root, designated, alternate, backup, disabled; stati forwarding, discarding, learning, disabled;
 * tipi physical, lag, vlan, vrrp, bridge, tunnel, wireless, other). Scritto sulle forme vere viste il 14/10 sera sui
 * quattro router della rete B (RouterOS 7.24.2 e 7.24.5, via ssh senza terminale); MK7 sulle uscite di due router in MSTP del
 * cliente A (RouterOS 7.24.4, T2-a, 16/10). Tre forme d'uscita:
 * - `print terse`: una riga per voce, `chiave=valore`, valori con spazi SENZA virgolette (si legge con `campiTerse`);
 * - la tabella di `monitor … once`: una colonna per elemento (bridge, porta, fascio), righe `etichetta: valore`; si legge
 *   per colonne, dalle posizioni della prima riga: divisa sugli spazi si sposta appena una cella è vuota (porta inattiva);
 * - un errore non catturato, scritto su stdout con ssh uscito con 0: si riconosce dal testo (`erroreRouterOs`).
 * Logica pura: niente rete, niente DB.
 */
import { campiTerse, righeDiUscita } from "@/lib/devices/mikrotik-vicini";
import type { FattiLettura, FattoBridgeIn, FattoPortaIn, MacApparatoIn } from "@/lib/db-tenant";
import { normale } from "@/lib/topology/cavi/porte";

const MAC = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;

function macValido(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  if (!MAC.test(v) || /^(00:){5}00$/.test(v)) return null;
  return v.toUpperCase();
}
const vuotoNull = (s: string | null | undefined): string | null => (s === null || s === undefined || s.trim() === "" ? null : s.trim());
function intero(s: string | null | undefined): number | null {
  const v = (s ?? "").trim();
  return /^-?\d+$/.test(v) ? Number(v) : null;
}
function siNo(s: string | null | undefined): boolean | null {
  const v = (s ?? "").trim().toLowerCase();
  return v === "yes" || v === "true" ? true : v === "no" || v === "false" ? false : null;
}
function priorita(s: string | undefined): number | null {
  const v = (s ?? "").trim();
  return /^0x[0-9a-f]+$/i.test(v) ? parseInt(v.slice(2), 16) : intero(v);
}
const lista = (s: string | null | undefined): string[] => (s ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "");
const zeroUno = (b: boolean | null | undefined): number | null => (b === true ? 1 : b === false ? 0 : null);

/** I segni fra l'indice e il primo campo di una riga `print terse` (« 1 RS name=…» → «RS»; « 0    name=…» → «»). */
export function segni(riga: string): string {
  const m = /^\s*\d+\s+([A-Z]+)\s/.exec(riga);
  return m ? m[1] : "";
}

// ── MK2: /interface print terse ──────────────────────────────────────────────

export interface InterfacciaMk {
  nome: string; tipo: string | null; mac: string | null; accesa: boolean; spenta: boolean;
  /** `mtu=` (intero; «auto» o assente = null), `comment=` (intero, anche con spazi) e `default-name=` (il nome di fabbrica). */
  mtu: number | null; commento: string | null; predefinito: string | null;
}

export function parseInterfacce(out: string): InterfacciaMk[] {
  const r: InterfacciaMk[] = [];
  for (const riga of righeDiUscita(out)) {
    const c = campiTerse(riga);
    const nome = c.get("name");
    if (!nome) continue;
    const s = segni(riga);
    r.push({ nome, tipo: c.get("type")?.toLowerCase() || null, mac: macValido(c.get("mac-address")), accesa: s.includes("R"), spenta: s.includes("X"),
      mtu: intero(c.get("mtu")), commento: vuotoNull(c.get("comment")), predefinito: vuotoNull(c.get("default-name")) });
  }
  return r;
}

/** Il tipo di RouterOS nella parola neutra (spec §13.5.1). Un tipo che non c'è qui è «other», mai indovinato dal nome. */
const TIPO_NEUTRO: Readonly<Record<string, string>> = {
  ether: "physical", bond: "lag", vlan: "vlan", vrrp: "vrrp", bridge: "bridge",
  wlan: "wireless", wifi: "wireless", w60g: "wireless",
  wg: "tunnel", "ovpn-out": "tunnel", "ovpn-client": "tunnel", "l2tp-out": "tunnel", "l2tp-client": "tunnel", "sstp-out": "tunnel",
  "pptp-out": "tunnel", gre: "tunnel", gre6: "tunnel", eoip: "tunnel", eoipv6: "tunnel", ipip: "tunnel", ipipv6: "tunnel", vxlan: "tunnel",
};
export function tipoNeutro(tipo: string | null): string | null {
  return tipo === null ? null : (TIPO_NEUTRO[tipo] ?? "other");
}

// ── MK3: /interface bridge print terse without-paging ────────────────────────

export interface BridgeMk {
  nome: string;
  modo: "stp" | "rstp" | "mstp" | "none" | null;
  priorita: number | null;
  regione: string | null;
  revisione: number | null;
  mac: string | null;
  vlanFiltering: boolean | null;
  maxAge: string | null;
  forwardDelay: string | null;
}
const MODI = new Set(["stp", "rstp", "mstp", "none"]);

export function parseBridge(out: string): BridgeMk[] {
  const r: BridgeMk[] = [];
  for (const riga of righeDiUscita(out)) {
    const c = campiTerse(riga);
    const nome = c.get("name");
    if (!nome) continue;
    const modo = (c.get("protocol-mode") ?? "").toLowerCase();
    r.push({
      nome, modo: MODI.has(modo) ? (modo as BridgeMk["modo"]) : null, priorita: priorita(c.get("priority")),
      regione: vuotoNull(c.get("region-name")), revisione: intero(c.get("region-revision")), mac: macValido(c.get("mac-address")),
      vlanFiltering: siNo(c.get("vlan-filtering")), maxAge: vuotoNull(c.get("max-message-age")), forwardDelay: vuotoNull(c.get("forward-delay")),
    });
  }
  return r;
}

// ── MK4: /interface bridge port print terse without-paging ───────────────────

export interface PortaBridgeMk { porta: string; bridge: string; pvid: number | null; inattiva: boolean }

export function parsePorteBridge(out: string): PortaBridgeMk[] {
  const r: PortaBridgeMk[] = [];
  for (const riga of righeDiUscita(out)) {
    const c = campiTerse(riga);
    const porta = c.get("interface"), bridge = c.get("bridge");
    if (!porta || !bridge) continue;
    r.push({ porta, bridge, pvid: intero(c.get("pvid")), inattiva: segni(riga).includes("I") });
  }
  return r;
}

// ── Le tabelle di monitor ─────────────────────────────────────────────────────

export interface TabellaMonitor { colonne: number; righe: ReadonlyMap<string, readonly string[]> }
const ETICHETTA = /^\s*([a-z][a-z0-9-]*):(?:\s|$)/;

/**
 * Una tabella di `monitor … once`. Il valore comincia due caratteri dopo i due punti dell'etichetta (le etichette sono
 * allineate a destra). Un confine di colonna è l'inizio di una parola della prima riga che in TUTTE le righe con
 * l'etichetta ha uno spazio davanti: così una cella vuota non sposta le altre, e una parola dentro un nome con uno spazio
 * non diventa una colonna. Una riga senza etichetta continua quella sopra (`active-ports` su più righe): le celle si
 * uniscono con la virgola. Le righe `;;; commento` non contano.
 */
export function tabellaMonitor(out: string): TabellaMonitor {
  const linee = out.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith(";;;"));
  const conEtichetta = linee.filter((l) => ETICHETTA.test(l));
  const prima = conEtichetta[0];
  if (prima === undefined) return { colonne: 0, righe: new Map() };
  const valore = prima.indexOf(":") + 2;
  const candidati: number[] = [];
  for (let p = valore; p < prima.length; p++) if (prima[p] !== " " && (p === valore || prima[p - 1] === " ")) candidati.push(p);
  const confini = candidati.filter((p) => p === valore || conEtichetta.every((l) => (l[p - 1] ?? " ") === " "));
  const righe = new Map<string, string[]>();
  let ultima: string | null = null;
  for (const l of linee) {
    const celle = confini.map((p, i) => l.slice(p, confini[i + 1] ?? l.length).trim());
    const m = ETICHETTA.exec(l);
    if (m) {
      righe.set(m[1], celle);
      ultima = m[1];
    } else if (ultima !== null && l.slice(0, valore).trim() === "") {
      const prec = righe.get(ultima) ?? [];
      righe.set(ultima, confini.map((_, i) => (celle[i] ? (prec[i] ? `${prec[i]},${celle[i]}` : celle[i]) : (prec[i] ?? ""))));
    }
  }
  return { colonne: confini.length, righe };
}

/** La cella i di una riga: "" vuota, null = la riga non c'è («non letto»). */
export function cella(t: TabellaMonitor, etichetta: string, i: number): string | null {
  const r = t.righe.get(etichetta);
  return r === undefined ? null : (r[i] ?? "");
}

/** Il bridge-id in una forma sola, «priorità.mac» con la priorità decimale e il MAC minuscolo: RouterOS scrive `0x8000.MAC` e, con priorità 0, `0.MAC`. */
export function bridgeIdNormale(s: string | null | undefined): string | null {
  const m = /^(0x[0-9a-fA-F]+|\d+)\.([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})$/.exec((s ?? "").trim());
  if (!m) return null;
  const p = m[1].toLowerCase().startsWith("0x") ? parseInt(m[1].slice(2), 16) : parseInt(m[1], 10);
  return `${p}.${m[2].toLowerCase()}`;
}

// ── MK5: /interface bridge monitor [find] once ───────────────────────────────

export interface MonitorBridgeMk {
  bridgeId: string | null;
  radice: boolean | null;
  radiceId: string | null;
  radiceRegionaleId: string | null;
  /** null = questo bridge è la radice, o la riga non c'è. */
  portaRadice: string | null;
  costo: number | null;
  digest: string | null;
}

/** Una colonna per bridge, senza una riga coi nomi: la colonna i è il bridge i di MK3 (stesso `[find]`, stesso ordine). */
export function parseMonitorBridge(out: string): MonitorBridgeMk[] {
  const t = tabellaMonitor(out);
  return Array.from({ length: t.colonne }, (_, i): MonitorBridgeMk => {
    const rp = vuotoNull(cella(t, "root-port", i));
    return {
      bridgeId: bridgeIdNormale(cella(t, "bridge-id", i)), radice: siNo(cella(t, "root-bridge", i)),
      radiceId: bridgeIdNormale(cella(t, "root-bridge-id", i)), radiceRegionaleId: bridgeIdNormale(cella(t, "regional-root-bridge-id", i)),
      portaRadice: rp === null || rp === "none" ? null : rp, costo: intero(cella(t, "root-path-cost", i)), digest: vuotoNull(cella(t, "mst-config-digest", i)),
    };
  });
}

// ── MK6: /interface bridge port monitor [find] once ──────────────────────────

export type RuoloStp = "root" | "designated" | "alternate" | "backup" | "disabled";
export type StatoStp = "forwarding" | "discarding" | "learning" | "disabled";
const RUOLI: Readonly<Record<string, RuoloStp>> = {
  "root-port": "root", "designated-port": "designated", "alternate-port": "alternate", "backup-port": "backup", "disabled-port": "disabled",
};

export interface MonitorPortaMk {
  porta: string;
  /** `status: in-bridge`; inattiva = tutte le altre celle vuote. */
  attiva: boolean;
  ruolo: RuoloStp | null;
  stato: StatoStp | null;
  bridgeDesignato: string | null;
  portaDesignata: string | null;
  costo: number | null;
  bordo: boolean | null;
  puntoPunto: boolean | null;
  rstp: boolean | null;
  /** Il secondo numero di `tx-rx-bpdu`: BPDU ricevuti (il vicino parla spanning tree). */
  bpduRicevuti: number | null;
}

export function parseMonitorPorte(out: string): MonitorPortaMk[] {
  const t = tabellaMonitor(out);
  const r: MonitorPortaMk[] = [];
  for (let i = 0; i < t.colonne; i++) {
    const porta = cella(t, "interface", i) ?? "";
    if (porta === "") continue;
    if (cella(t, "status", i) !== "in-bridge") {
      r.push({ porta, attiva: false, ruolo: null, stato: null, bridgeDesignato: null, portaDesignata: null, costo: null, bordo: null, puntoPunto: null, rstp: null, bpduRicevuti: null });
      continue;
    }
    const ruolo = RUOLI[cella(t, "role", i) ?? ""] ?? null;
    const avanti = siNo(cella(t, "forwarding", i)), impara = siNo(cella(t, "learning", i));
    // Lo stato viene da forwarding e learning (`status` dice solo in-bridge o inactive, spec §13.5.2).
    const stato: StatoStp | null = avanti === true ? "forwarding" : impara === true ? "learning"
      : avanti === false ? (ruolo === "disabled" ? "disabled" : "discarding") : null;
    const bpdu = /^(\d+)\/(\d+)$/.exec(cella(t, "tx-rx-bpdu", i) ?? "");
    r.push({
      porta, attiva: true, ruolo, stato, bridgeDesignato: bridgeIdNormale(cella(t, "designated-bridge-id", i)),
      portaDesignata: vuotoNull(cella(t, "designated-port-id", i)), costo: intero(cella(t, "actual-path-cost", i)),
      bordo: siNo(cella(t, "edge-port", i)), puntoPunto: siNo(cella(t, "point-to-point-port", i)), rstp: siNo(cella(t, "sending-rstp", i)),
      bpduRicevuti: bpdu ? Number(bpdu[2]) : null,
    });
  }
  return r;
}

// ── MK7: /interface bridge msti print terse without-paging e msti monitor [find] once ──

export interface IstanzaMk { bridge: string; identificatore: number; vlan: string; priorita: number | null }
export interface MonitorIstanzaMk {
  identificatore: number | null;
  /** `current-mac-address`: il MAC del bridge della colonna (null = riga assente o non un MAC). */
  mac: string | null;
  radiceRegionaleId: string | null;
  /** null = `none` (il bridge è la radice dell'istanza), o porta non letta: lo dice `portaRadiceNota`. */
  portaRadice: string | null;
  /** false = la riga `root-port` manca o la cella è vuota: la porta radice non è letta, non è «radice». */
  portaRadiceNota: boolean;
}

/** La mappa delle VLAN di un'istanza: «n» o «n-m» separati da virgole (`77`, `1-76,78-4094`). */
const MAPPA_VLAN = /^\d{1,4}(-\d{1,4})?(,\d{1,4}(-\d{1,4})?)*$/;

/**
 * Una riga per istanza. L'istanza 0 è l'albero comune: RouterOS la crea da sé e la segna `D` (« 1 D identifier=0 …»), e si
 * legge come le altre. Senza MSTP l'uscita è vuota (nessun errore, 14/10). Una mappa delle VLAN in un'altra forma resta
 * vuota (VLAN non lette): letta a metà direbbe attive solo le VLAN del pezzo capito.
 */
export function parseMsti(out: string): IstanzaMk[] {
  const r: IstanzaMk[] = [];
  for (const riga of righeDiUscita(out)) {
    const c = campiTerse(riga);
    const id = intero(c.get("identifier"));
    const bridge = c.get("bridge");
    if (id === null || !bridge) continue;
    const vlan = (c.get("vlan-mapping") ?? "").trim();
    r.push({ bridge, identificatore: id, vlan: MAPPA_VLAN.test(vlan) ? vlan : "", priorita: priorita(c.get("priority")) });
  }
  return r;
}

/**
 * Una colonna per istanza, nell'ordine di `msti print` (stesso `[find]`), con la riga `identifier` (una riga col nome del bridge
 * non c'è: il bridge lo dice `current-mac-address`, il suo MAC). La radice regionale di un'istanza è scritta col numero
 * dell'istanza sommato alla priorità (0x1001.MAC per priorità 0x1000 nell'istanza 1), `bridge-id` e `priority` senza: si toglie,
 * così tutte e tre dicono la stessa priorità. `root-port: none` = nessuna porta radice; riga assente o cella vuota = non letta.
 */
export function parseMonitorMsti(out: string): MonitorIstanzaMk[] {
  const t = tabellaMonitor(out);
  return Array.from({ length: t.colonne }, (_, i): MonitorIstanzaMk => {
    const id = intero(cella(t, "identifier", i));
    const rp = vuotoNull(cella(t, "root-port", i));
    return {
      identificatore: id, mac: macValido(cella(t, "current-mac-address", i)),
      radiceRegionaleId: senzaIstanza(bridgeIdNormale(cella(t, "regional-root-bridge-id", i)), id),
      portaRadice: rp === null || rp === "none" ? null : rp, portaRadiceNota: rp !== null,
    };
  });
}

/** «4097.mac» nell'istanza 1 → «4096.mac»; se i 12 bit bassi della priorità non sono il numero dell'istanza resta com'è. */
function senzaIstanza(id: string | null, istanza: number | null): string | null {
  if (id === null || istanza === null) return id;
  const punto = id.indexOf(".");
  const p = Number(id.slice(0, punto));
  return (p & 0xfff) === istanza ? `${p - istanza}${id.slice(punto)}` : id;
}

// ── MK8: /interface bonding print terse e monitor [find] once ────────────────

export interface FascioMk { nome: string; membri: string[]; modo: string | null }
export interface MonitorFascioMk { attivi: string[]; inattivi: string[]; partner: string | null }

export function parseFasci(out: string): FascioMk[] {
  const r: FascioMk[] = [];
  for (const riga of righeDiUscita(out)) {
    const c = campiTerse(riga);
    const nome = c.get("name");
    if (!nome) continue;
    r.push({ nome, membri: lista(c.get("slaves")), modo: vuotoNull(c.get("mode")) });
  }
  return r;
}

/** Una colonna per fascio, nell'ordine di `print`. `lacp-partner-system-id` c'è solo se c'è un partner. */
export function parseMonitorFasci(out: string): MonitorFascioMk[] {
  const t = tabellaMonitor(out);
  return Array.from({ length: t.colonne }, (_, i): MonitorFascioMk => ({
    attivi: lista(cella(t, "active-ports", i)), inattivi: lista(cella(t, "inactive-ports", i)), partner: macValido(cella(t, "lacp-partner-system-id", i)),
  }));
}

// ── Errori ───────────────────────────────────────────────────────────────────

// I tre in fondo dalla revisione del Task 4 di T2: fuori elenco passavano per uscite buone («failure: …» ha la forma di una
// riga di `monitor`). Un messaggio che resta fuori elenco e non dà righe al lettore vale USCITA_NON_CAPITA (mikrotik-letture).
const ERRORI: ReadonlyArray<readonly [RegExp, string]> = [
  [/^no such item\b/m, "NO_SUCH_ITEM"], [/^bad command name\b/m, "BAD_COMMAND"],
  [/^syntax error\b/m, "SYNTAX_ERROR"], [/^expected end of command\b/m, "EXPECTED_END"],
  [/^failure:/m, "FAILURE"], [/^not enough permissions\b/m, "NOT_ENOUGH_PERMISSIONS"],
  [/^input does not match\b/m, "INPUT_DOES_NOT_MATCH"],
];
/** Il codice di un errore di RouterOS dal testo dell'uscita (a inizio riga), o null. Non conta sul codice d'uscita di ssh. */
export function erroreRouterOs(testo: string): string | null {
  const t = testo.replace(/\r/g, "");
  for (const [re, codice] of ERRORI) if (re.test(t)) return codice;
  return null;
}

// ── I fatti da scrivere ───────────────────────────────────────────────────────

/** Una lettura: null = quel comando non è riuscito (o non è stato mandato), [] = riuscito e vuoto. */
export interface LetturaMk {
  interfacce: InterfacciaMk[] | null;
  bridge: BridgeMk[] | null;
  porteBridge: PortaBridgeMk[] | null;
  monitorBridge: MonitorBridgeMk[] | null;
  monitorPorte: MonitorPortaMk[] | null;
  fasci: FascioMk[] | null;
  monitorFasci: MonitorFascioMk[] | null;
  /** MK7: null anche quando non si manda (nessun bridge in MSTP, MK3 non letto, `msti print` non riuscito per il monitor). */
  istanze: IstanzaMk[] | null;
  monitorIstanze: MonitorIstanzaMk[] | null;
}

/**
 * I fatti per `scriviFattiTopologia` (fonte `device`). La chiave della porta è il nome normalizzato («n:…»): il MikroTik
 * letto via SSH non dà un indice. Un membro di un fascio sta nel bridge se ci sta il fascio (in MK4 il fascio compare come
 * porta, i membri no); lo stato dello spanning tree è del fascio, non dei membri. Senza MK4 «nel bridge» non è noto.
 *
 * MK7, solo per i bridge in MSTP: una riga per istanza (`instance` = identificatore, VLAN, porta radice, radice regionale).
 * L'istanza 0 è l'albero comune, già scritto da MK3 e MK5: non diventa una riga sua (avrebbe la stessa chiave, e la scrittura
 * dopo cancellerebbe regione e digest), gli dà solo le VLAN. Le righe d'istanza si scrivono solo col monitor letto e ogni
 * colonna dell'istanza che le sta accanto con lo stesso `identifier`, il MAC del suo bridge (`current-mac-address`: con due
 * bridge in MSTP i numeri d'istanza si ripetono) e la porta radice letta; altrimenti nessuna, e il modello dice «istanze non
 * lette»: mai la porta radice di un'altra istanza o di un altro bridge, mai «radice» dove la porta non è letta (`root_port` NULL
 * vuol dire radice). Revisione finale di T3, M2 e M5.
 */
export function fattiMikrotik(l: LetturaMk): FattiLettura {
  const chiave = (nome: string): string => `n:${normale(nome)}`;
  const nelBridge = new Map((l.porteBridge ?? []).map((p) => [p.porta, p]));
  const fascioDi = new Map<string, string>();
  for (const f of l.fasci ?? []) for (const m of f.membri) fascioDi.set(m, f.nome);
  const partnerDi = new Map<string, string | null>();
  (l.fasci ?? []).forEach((f, i) => partnerDi.set(f.nome, l.monitorFasci?.[i]?.partner ?? null));
  const stp = new Map((l.monitorPorte ?? []).map((m) => [m.porta, m]));
  const porte: FattoPortaIn[] = [];
  const macs: MacApparatoIn[] = [];
  for (const i of l.interfacce ?? []) {
    const fascio = fascioDi.get(i.nome) ?? (i.tipo === "bond" ? i.nome : null);
    const pb = nelBridge.get(i.nome) ?? (fascio !== null ? nelBridge.get(fascio) : undefined);
    const m = stp.get(i.nome);
    porte.push({
      port_key: chiave(i.nome), port_name: i.nome, port_index: null, if_kind: tipoNeutro(i.tipo), running: i.accesa ? 1 : 0,
      in_bridge: l.porteBridge === null ? null : pb ? 1 : 0, bridge: pb?.bridge ?? null,
      lag_group: fascio, lag_partner: fascio !== null ? (partnerDi.get(fascio) ?? null) : null,
      stp_role: m?.ruolo ?? null, stp_state: m?.stato ?? null, designated_bridge: m?.bridgeDesignato ?? null,
      designated_port: m?.portaDesignata ?? null, path_cost: m?.costo ?? null, edge: zeroUno(m?.bordo), point_to_point: zeroUno(m?.puntoPunto),
      sending_rstp: zeroUno(m?.rstp), bpdu_rx: m?.bpduRicevuti ?? null,
    });
    if (i.mac) macs.push({ mac: i.mac, port_key: chiave(i.nome) });
  }
  const inMstp = new Set((l.bridge ?? []).filter((b) => b.modo === "mstp").map((b) => b.nome));
  const istanze = (l.istanze ?? []).map((ist, i) => ({ ist, mon: l.monitorIstanze?.[i] })).filter((x) => inMstp.has(x.ist.bridge));
  const vlanComune = new Map(istanze.filter((x) => x.ist.identificatore === 0).map((x) => [x.ist.bridge, x.ist.vlan || null]));
  const altre = istanze.filter((x) => x.ist.identificatore > 0);
  const macDelBridge = new Map((l.bridge ?? []).map((b) => [b.nome, b.mac]));
  const monitorBuono = l.monitorIstanze !== null && altre.every((x) => x.mon !== undefined && x.mon.identificatore === x.ist.identificatore
    && x.mon.portaRadiceNota && x.mon.mac !== null && x.mon.mac === (macDelBridge.get(x.ist.bridge) ?? null));
  const bridge: FattoBridgeIn[] = (l.bridge ?? []).map((b, i) => {
    const mon = l.monitorBridge?.[i];
    return {
      bridge_name: b.nome, instance: 0, protocol: b.modo, priority: b.priorita,
      bridge_id: mon?.bridgeId ?? (b.mac && b.priorita !== null ? `${b.priorita}.${b.mac.toLowerCase()}` : null),
      root_id: mon?.radiceId ?? null, regional_root_id: mon?.radiceRegionaleId ?? null, region_name: b.regione, region_revision: b.revisione,
      config_digest: mon?.digest ?? null, vlans: vlanComune.get(b.nome) ?? null, root_port: mon?.portaRadice ?? null, root_path_cost: mon?.costo ?? null,
    };
  });
  if (monitorBuono) {
    for (const { ist, mon } of altre) {
      bridge.push({
        bridge_name: ist.bridge, instance: ist.identificatore, protocol: "mstp", priority: ist.priorita,
        regional_root_id: mon?.radiceRegionaleId ?? null, vlans: ist.vlan || null, root_port: mon?.portaRadice ?? null,
      });
    }
  }
  const visti = new Set<string>();
  return { porte, bridge, macs: macs.filter((m) => !visti.has(m.mac) && !!visti.add(m.mac)) };
}
