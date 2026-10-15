/**
 * La lettura dal lato dell'host (spec topologia §13.5.5, T2.5), dentro la lettura degli hypervisor (`hypervisor_sync`), dietro
 * `topologia.lettura.host` (spenta di default) e con la cadenza propria delle letture in più (cadenza.ts). Per ogni nodo
 * dell'apparato una connessione SSH e tre comandi a parte, ognuno col suo tempo massimo (COMANDI_HOST):
 *   1. `command -v lldpcli`: uscita 0 con un percorso = c'è; uscita 1 = «lldpd non installato», una risposta e non un errore;
 *   2. solo se c'è, `lldpcli -f json0 show neighbors details` (json0: ogni campo è un elenco anche con un vicino solo, e il
 *      lettore è uno; `details` aggiunge capacità e indirizzi di gestione, quando lo switch li manda);
 *   3. `ip -d -j link show`: tipo e stato delle schede, stato e MAC permanente dei membri dei bond.
 * Mai accodato a LIVE_INTERFACES_COMMAND (I54: su un host senza lldpcli l'uscita 1 farebbe perdere le schede vive). Solo le
 * righe via LLDP diventano vicini (`lldp`, fonte `host`); CDP, EDP, FDP e SONMP no (I52: il vincolo di `protocol` le
 * rifiuterebbe e il giro intero dell'apparato fallirebbe). Sola lettura: niente che scriva sull'hypervisor.
 *
 * Tre esiti per comando (spec §13.5.1): letto; non riuscito (uscita diversa da quella attesa, col codice); non so (tempo
 * scaduto, connessione caduta, uscita che non si capisce). Un «non so» non scrive mai un elenco vuoto: i vicini o i fatti di
 * quel comando non si scrivono e l'esito porta il codice. Se nessun comando dà qualcosa da scrivere la lettura non è riuscita.
 *
 * Il parser è scritto sull'uscita vera T2-b (nodo Proxmox VE 9 dell'hub, lldpd 1.0.18; fixture anonime in
 * `__tests__/fixtures/`): gli switch UniFi non mandano `mgmt-ip`, e uno dei due nemmeno `capability`. Un campo che non c'è
 * resta assente nel vicino, mai una stringa vuota.
 */
import {
  getDeviceCredentialBindings, getDeviceCredentials, getNetworkDeviceById, getNetworkDevices, scriviFattiTopologia, upsertNeighbors,
  type FattiLettura, type FattoPortaIn, type MacApparatoIn,
} from "@/lib/db-tenant";
import { CODICE_USCITA_NON_CAPITA, codiceTrasporto, eseguiSuSshConCodice } from "@/lib/devices/mikrotik-letture";
import type { SshOptions } from "@/lib/devices/ssh-transport";
import { membriDeiBond, parseLiveInterfaces, type LiveInterfaceKind } from "@/lib/proxmox/live-interfaces";
import { proxmoxSshPort, proxmoxSshUsername, resolveProxmoxTargetIps } from "@/lib/proxmox/proxmox-targets";
import { normale } from "@/lib/topology/cavi/porte";
import { conCadenza, type EsitoGiro } from "@/lib/topology/letture/cadenza";
import { letturaAccesa, oraUtc } from "@/lib/topology/letture/interruttori";
import { normalizeMacForStorage } from "@/lib/utils";
import type { NetworkDevice } from "@/types";

/** I comandi, esatti e separati (I54), in sola lettura. */
export const COMANDI_HOST = {
  cerca: "command -v lldpcli",
  vicini: "lldpcli -f json0 show neighbors details",
  schede: "ip -d -j link show",
} as const;

/** Il tempo massimo di ogni comando (spec §13.5.1), come per i MikroTik. */
export const TEMPO_HOST_MS = 20_000;
/** Il tempo massimo per aprire la connessione, come la lettura delle schede vive dello stesso nodo. */
const TEMPO_CONNESSIONE_MS = 15_000;

export const CODICE_JSON_ILLEGGIBILE = "JSON_ILLEGGIBILE";
export const CODICE_LLDPCLI_NON_RIUSCITO = "LLDPCLI_NON_RIUSCITO";
export const CODICE_USCITA_NON_ZERO = "USCITA_NON_ZERO";
export const CODICE_NODO_NON_CENSITO = "NODO_NON_CENSITO";
export const CODICE_NODO_AMBIGUO = "NODO_AMBIGUO";

/** Un vicino letto da `lldpcli`, nella forma di `upsertNeighbors`. I campi opzionali ci sono solo se l'uscita li porta. */
export interface VicinoHost {
  localPort: string;
  remoteDevice: string;
  remotePort: string;
  protocol: "lldp";
  remoteMac?: string;
  remoteIp?: string;
  remoteCaps?: string;
}

const conCodice = (messaggio: string, code: string): Error => Object.assign(new Error(messaggio), { code });
const elenco = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const voce = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
const testoDi = (o: Record<string, unknown>): string => (typeof o.value === "string" ? o.value.trim() : "");
/** I valori di testo non vuoti di un campo di json0 (`[{ "value": … }]`). */
const valori = (x: unknown): string[] => elenco(x).map((v) => testoDi(voce(v))).filter((v) => v !== "");
const ipv4 = (s: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split(".").every((n) => Number(n) <= 255);
/** I nomi delle capacità di lldpd nella forma delle altre letture (SNMP, MikroTik): minuscole, `wlan-ap`, `telephone`. */
const CAPACITA: Readonly<Record<string, string>> = { wlan: "wlan-ap", tel: "telephone" };

/**
 * I vicini di `lldpcli -f json0 show neighbors details`: `lldp[].interface[]` con `name` (la scheda), `via` (il protocollo),
 * `chassis[]` (`id[]{type,value}`, `name[]`, `descr[]`, e con `details` `mgmt-ip[]` e `capability[]{type,enabled}` se lo
 * switch li manda) e `port[]` (`id[]{type,value}`, `descr[]`). La porta remota è l'id della porta (sugli switch UniFi il tipo
 * è `local` col nome della porta, «Port 19»); se l'id è un MAC, la descrizione. Il nome remoto: il nome di sistema, se no il
 * telaio (il MAC, o il suo testo). Una riga senza scheda o senza chi c'è dall'altra parte non è un vicino.
 * Un'uscita che non è JSON è `JSON_ILLEGGIBILE`; un JSON senza `lldp` è `USCITA_NON_CAPITA`: mai «nessun vicino».
 */
export function parseLldpcliJson0(testo: string): VicinoHost[] {
  let j: unknown;
  try {
    j = JSON.parse(testo);
  } catch {
    throw conCodice("Uscita di lldpcli non leggibile", CODICE_JSON_ILLEGGIBILE);
  }
  const radice = voce(j).lldp;
  // json0 mette tutto in elenchi; un oggetto solo si accetta lo stesso (la forma senza vicini non è stata vista dal vero).
  if (radice === null || typeof radice !== "object") throw conCodice("Uscita di lldpcli senza «lldp»", CODICE_USCITA_NON_CAPITA);
  const out: VicinoHost[] = [];
  for (const l of Array.isArray(radice) ? radice : [radice]) {
    for (const i of elenco(voce(l).interface)) {
      const r = voce(i);
      if (typeof r.via !== "string" || r.via.trim().toUpperCase() !== "LLDP") continue; // I52
      const scheda = typeof r.name === "string" ? r.name.trim() : "";
      const ch = voce(elenco(r.chassis)[0]);
      const po = voce(elenco(r.port)[0]);
      const idCh = voce(elenco(ch.id)[0]);
      const idPo = voce(elenco(po.id)[0]);
      const mac = idCh.type === "mac" ? normalizeMacForStorage(testoDi(idCh)) : null;
      const remoteDevice = valori(ch.name)[0] ?? mac ?? testoDi(idCh);
      if (scheda === "" || remoteDevice === "") continue;
      const idPorta = testoDi(idPo);
      const remotePort = idPo.type === "mac"
        ? (valori(po.descr)[0] ?? normalizeMacForStorage(idPorta) ?? "")
        : (idPorta || (valori(po.descr)[0] ?? ""));
      const ip = valori(ch["mgmt-ip"]).find(ipv4);
      const capacita = [...new Set(elenco(ch.capability).map(voce).filter((c) => c.enabled === true)
        .map((c) => (typeof c.type === "string" ? c.type.trim().toLowerCase() : "")).filter((c) => c !== "")
        .map((c) => CAPACITA[c] ?? c))].sort();
      out.push({
        localPort: scheda, remoteDevice, remotePort, protocol: "lldp",
        ...(mac ? { remoteMac: mac } : {}), ...(ip ? { remoteIp: ip } : {}), ...(capacita.length > 0 ? { remoteCaps: capacita.join(",") } : {}),
      });
    }
  }
  return out;
}

const TIPO_SCHEDA: Readonly<Record<LiveInterfaceKind, string>> = { eth: "physical", bond: "lag", bridge: "bridge", vlan: "vlan", other: "other" };

/**
 * I fatti delle schede di un nodo (fonte `host`): tipo, acceso, bond e stato del membro (`attivo`/`riserva`, «riserva del
 * bond»: non è lo spanning tree a fermarlo). Fra i MAC dell'apparato i permanenti dei membri dei bond (quelli con cui il
 * firmware delle schede si annuncia agli switch) e quelli delle schede fisiche fuori dai bond; mai il MAC di adesso di un
 * membro, che è quello del bond.
 */
export function fattiHost(ipLinkJson: unknown): FattiLettura {
  const schede = parseLiveInterfaces(ipLinkJson, {});
  const membri = new Map(membriDeiBond(ipLinkJson).map((m) => [m.nome, m]));
  const porte: FattoPortaIn[] = schede.map((s) => {
    const m = membri.get(s.name);
    return {
      port_key: `n:${normale(s.name)}`, port_name: s.name, port_index: null, if_kind: TIPO_SCHEDA[s.kind],
      running: s.state === "up" ? 1 : s.state === "down" ? 0 : null,
      lag_group: m?.bond ?? (s.kind === "bond" ? s.name : null), lag_state: m?.stato ?? null,
    };
  });
  const macs: MacApparatoIn[] = [];
  const visti = new Set<string>();
  const metti = (mac: string | null, scheda: string): void => {
    if (!mac || visti.has(mac)) return;
    visti.add(mac);
    macs.push({ mac, port_key: `n:${normale(scheda)}` });
  };
  for (const m of membri.values()) metti(m.macPermanente, m.nome);
  for (const s of schede) if (s.kind === "eth" && !membri.has(s.name)) metti(s.mac, s.name);
  return { porte, bridge: [], macs };
}

export type EseguiHost = (comando: string) => Promise<{ stdout: string; code: number }>;
export type ApriHost = <T>(opts: SshOptions, fn: (esegui: EseguiHost) => Promise<T>) => Promise<T>;

/**
 * La connessione vera: una per nodo, chiusa alla fine anche se un comando fallisce. Il codice d'uscita torna com'è (serve a
 * `command -v`). Una connessione caduta, o un canale chiuso senza codice d'uscita, è `CONNESSIONE_CADUTA` («non so»: l'uscita
 * può essere tagliata), e dopo una caduta i comandi successivi non partono; una connessione che non si apre ha il solo
 * codice (`SSH_<TIPO>`), mai il messaggio di ssh con host e utente. Sta sulla stessa base dei MikroTik (`eseguiSuSshConCodice`).
 */
export const apriHostSsh: ApriHost = (opts, fn) =>
  eseguiSuSshConCodice(opts, (esegui) => fn(async (comando) => {
    const r = await esegui(comando, TEMPO_HOST_MS);
    return { stdout: r.stdout, code: r.code };
  }));

interface LetturaNodo {
  /** null = non letti (lldpd assente, o il comando non è riuscito); [] = letti e nessuno. */
  vicini: VicinoHost[] | null;
  /** null = non lette. */
  schede: unknown[] | null;
  comandi: number;
  riusciti: number;
  /** Il primo errore, col solo codice. */
  codice: string | null;
}

/** I tre comandi su una connessione già aperta, ognuno col suo esito; un errore non ferma i comandi dopo. */
async function leggiNodo(esegui: EseguiHost): Promise<LetturaNodo> {
  let comandi = 0, riusciti = 0;
  let codice: string | null = null;
  const segna = (err: unknown): void => { codice ??= codiceTrasporto(err); };

  comandi++;
  let conLldp = false;
  try {
    const r = await esegui(COMANDI_HOST.cerca);
    if (r.code === 0 && r.stdout.trim() !== "") {
      conLldp = true;
      riusciti++;
    } else if (r.code === 1 && r.stdout.trim() === "") {
      riusciti++; // lldpd non installato: una risposta, non un errore (I54)
    } else {
      segna(conCodice("command -v: uscita inattesa", r.code === 0 ? CODICE_USCITA_NON_CAPITA : CODICE_USCITA_NON_ZERO));
    }
  } catch (e) {
    segna(e);
  }

  let vicini: VicinoHost[] | null = null;
  if (conLldp) {
    comandi++;
    try {
      const r = await esegui(COMANDI_HOST.vicini);
      if (r.code !== 0) throw conCodice("lldpcli non riuscito", CODICE_LLDPCLI_NON_RIUSCITO);
      vicini = parseLldpcliJson0(r.stdout);
      riusciti++;
    } catch (e) {
      segna(e);
    }
  }

  comandi++;
  let schede: unknown[] | null = null;
  try {
    const r = await esegui(COMANDI_HOST.schede);
    if (r.code !== 0) throw conCodice("ip link non riuscito", CODICE_USCITA_NON_ZERO);
    let j: unknown;
    try {
      j = JSON.parse(r.stdout);
    } catch {
      throw conCodice("Uscita di «ip -j link» non leggibile", CODICE_JSON_ILLEGGIBILE);
    }
    // Un elenco vuoto non è una risposta di `ip link` (c'è sempre almeno `lo`): «non so», non «nessuna scheda».
    if (!Array.isArray(j) || j.length === 0) throw conCodice("Uscita di «ip -j link»: non è un elenco di schede", CODICE_USCITA_NON_CAPITA);
    schede = j;
    riusciti++;
  } catch (e) {
    segna(e);
  }
  return { vicini, schede, comandi, riusciti, codice };
}

/**
 * L'apparato su cui si scrivono le righe di un nodo di un cluster (piano di T2, Task 7): quello con `host` uguale
 * all'indirizzo del nodo; fra più d'uno, l'unico hypervisor. Nessuno, o più d'uno senza un hypervisor solo: non si sceglie a
 * caso, il nodo non si legge e il resoconto lo conta. Così la porta locale (la scheda) è sempre di un apparato solo.
 */
function apparatoDelNodo(candidati: readonly NetworkDevice[]): { id: number } | { codice: string } {
  if (candidati.length === 0) return { codice: CODICE_NODO_NON_CENSITO };
  if (candidati.length === 1) return { id: candidati[0].id };
  const hyp = candidati.filter((d) => d.device_type === "hypervisor");
  return hyp.length === 1 ? { id: hyp[0].id } : { codice: CODICE_NODO_AMBIGUO };
}

/**
 * La lettura dell'host per un apparato hypervisor: per ogni suo nodo, con la cadenza propria (al più una volta l'ora per
 * apparato). Un apparato con un nodo solo scrive su sé stesso; un cluster su un apparato solo («a,b,c») scrive ogni nodo
 * sul suo apparato (`apparatoDelNodo`). Credenziali, porta e utente SSH come la scansione Proxmox
 * (`runProxmoxDeviceScan`). Spenta: niente, nemmeno una connessione.
 */
export async function leggiHost(deviceId: number, apri: ApriHost = apriHostSsh, adesso?: () => Date): Promise<Array<EsitoGiro<unknown>>> {
  if (!letturaAccesa("host")) return [{ stato: "saltato", motivo: "spenta" }];
  const device = getNetworkDeviceById(deviceId);
  if (!device) return [];
  const creds = getDeviceCredentials(device);
  const nodi = resolveProxmoxTargetIps(device);
  if (!creds || nodi.length === 0) {
    const codice = !creds ? "SENZA_CREDENZIALI" : "SENZA_INDIRIZZO";
    return [await conCadenza("host", deviceId, async () => { throw conCodice("Lettura dell'host non possibile", codice); }, adesso)];
  }
  const port = proxmoxSshPort(getDeviceCredentialBindings(device.id));
  const username = proxmoxSshUsername(creds.username);
  // Una query per tutto il cluster, non una per nodo.
  const perIndirizzo = new Map<string, NetworkDevice[]>();
  if (nodi.length > 1) {
    for (const d of getNetworkDevices()) {
      if (!d.enabled) continue; // un apparato spento sullo stesso indirizzo non rende il nodo ambiguo né riceve righe
      const h = (d.host ?? "").trim();
      perIndirizzo.set(h, [...(perIndirizzo.get(h) ?? []), d]);
    }
  }
  const esiti: Array<EsitoGiro<unknown>> = [];
  for (const ip of nodi) {
    const dev = nodi.length === 1 ? { id: deviceId } : apparatoDelNodo(perIndirizzo.get(ip) ?? []);
    if ("codice" in dev) {
      esiti.push({ stato: "errore", esito: { il: oraUtc(adesso?.() ?? new Date()), comandi: 0, riusciti: 0, codice: dev.codice } });
      continue;
    }
    esiti.push(await conCadenza("host", dev.id, async () => {
      const r = await apri({ host: ip, port, username, password: creds.password, timeout: TEMPO_CONNESSIONE_MS }, leggiNodo);
      if (r.schede === null && r.vicini === null) throw conCodice("Lettura dell'host non riuscita", r.codice ?? "NESSUNA_LETTURA");
      const fatti = r.schede !== null ? scriviFattiTopologia(dev.id, "host", fattiHost(r.schede), adesso?.() ?? new Date()) : null;
      if (r.vicini !== null && r.vicini.length > 0) upsertNeighbors(dev.id, r.vicini, "host");
      return { valore: { fatti, vicini: r.vicini?.length ?? null }, conteggio: { comandi: r.comandi, riusciti: r.riusciti, codice: r.codice } };
    }, adesso));
  }
  return esiti;
}
