/**
 * Esecuzione di un profilo di scansione su un elenco di IP.
 *
 * Gira **solo** sugli host scelti a mano nella lista (la rotta pretende
 * `host_ids`): sono scansioni lunghe e, per il profilo IoT/OT, pacchetti verso
 * apparati di campo. Due invocazioni per host, TCP e UDP, come nel resto del
 * codice.
 */
import { execFile } from "child_process";
import { segnaleGiro } from "../ferma-giro";
import { promisify } from "util";
import type { NmapResult } from "@/types";
import { parseNmapXml } from "../nmap";
import { argomentiTcp, argomentiUdp, scriptMancanti } from "./comando";
import { rilieviDaRisultato, fattiDaRisultato } from "./lettura";
import type { FattiProfilo, ProfiloScansione, RilievoProfilo } from "./tipi";
import { PROFILI, scriptDelProfilo } from "./profili";

const execFileAsync = promisify(execFile);

/** Host in parallelo: poche, sono scansioni pesanti (OS detection, 30 script). */
const HOST_PARALLELI = 4;

let cacheDisponibili: ReadonlySet<string> | null | undefined;

/** Tutti gli script citati da qualunque profilo, senza duplicati. Esportata per le prove. */
export function tuttiGliScriptCandidati(): string[] {
  const set = new Set<string>();
  for (const p of PROFILI) for (const s of scriptDelProfilo(p)) set.add(s);
  return [...set].sort();
}

/**
 * Gli script NSE presenti sulla macchina, fra tutti quelli che i profili citano.
 *
 * Serve perche' nmap con un nome di script che non esiste **aborta tutta la
 * scansione**: meglio sapere prima e dirlo. Prima `--script-help` in un processo
 * solo; se fallisce, script per script. Se nemmeno quello riesce torna `null`, e
 * il motore passa tutti gli script lasciando parlare nmap.
 *
 * L'insieme e' quello di TUTTI i profili, non del profilo che si sta eseguendo:
 * la cache vive per tutta la vita del processo, e riempiendola coi soli nomi
 * dell'Approfondito il profilo IoT/OT al giro dopo si sarebbe visto filtrare via
 * **tutti** i suoi script — non erano nella cache — e sarebbe girato senza
 * nessuno, in silenzio. Difetto trovato rileggendo, il 04/11/2026.
 */
export async function scriptDisponibili(): Promise<ReadonlySet<string> | null> {
  if (cacheDisponibili !== undefined) return cacheDisponibili;
  const candidati = tuttiGliScriptCandidati();
  if (candidati.length === 0) {
    cacheDisponibili = new Set<string>();
    return cacheDisponibili;
  }
  try {
    const { stdout } = await execFileAsync("nmap", ["--script-help", candidati.join(",")], {
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    /* `--script-help` stampa il nome dello script su una riga da solo, poi
     * "Categories:" e la descrizione. Un nome assente semplicemente non compare. */
    const righe = new Set(stdout.split("\n").map((r) => r.trim()));
    const trovati = new Set(candidati.filter((c) => righe.has(c)));
    if (trovati.size > 0) {
      cacheDisponibili = trovati;
      return cacheDisponibili;
    }
  } catch {
    /* Basta UN nome inesistente perche' nmap esca con errore e non stampi
     * nulla: allora si chiede script per script. Costa una trentina di
     * processi, una volta sola per vita del processo, ed e' deterministico —
     * non un ciclo di tentativi al buio (REGOLA #0). */
  }
  const trovati = new Set<string>();
  const coda = [...candidati];
  const lavoratore = async (): Promise<void> => {
    for (;;) {
      const nome = coda.shift();
      if (!nome) return;
      try {
        const { stdout } = await execFileAsync("nmap", ["--script-help", nome], {
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
        });
        if (stdout.split("\n").some((r) => r.trim() === nome)) trovati.add(nome);
      } catch {
        /* Script assente: non si aggiunge, e il profilo lo dichiarera' mancante. */
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: 6 }, () => lavoratore()));
  } catch {
    /* nmap non eseguibile: non sappiamo niente. */
    cacheDisponibili = null;
    return cacheDisponibili;
  }
  /* Zero script trovati con nmap presente e' sospetto (versione che stampa in
   * un altro formato): meglio dichiarare "non lo so" e lasciare parlare nmap,
   * che filtrare via tutto e girare senza nessuno script in silenzio. */
  cacheDisponibili = trovati.size > 0 ? trovati : null;
  return cacheDisponibili;
}

/** Solo per le prove: azzera la cache degli script trovati. */
export function azzeraCacheScript(): void {
  cacheDisponibili = undefined;
}

/**
 * Privilegi per `-O` e `-sU`: servono raw socket, quindi root (o CAP_NET_RAW).
 * `DA_INVENT_NMAP_SENZA_PRIVILEGI=1` li dichiara assenti anche da root: serve
 * per provare la degradazione senza cambiare utente.
 */
export function haPrivilegi(): boolean {
  if (process.env.DA_INVENT_NMAP_SENZA_PRIVILEGI === "1") return false;
  try {
    return typeof process.getuid === "function" && process.getuid() === 0;
  } catch {
    return false;
  }
}

export interface EsitoHost {
  ip: string;
  /** `null` = nmap non ha restituito nulla di utile per questo IP. */
  risultato: NmapResult | null;
  rilievi: RilievoProfilo[];
  fatti: FattiProfilo;
  /** Fase UDP saltata e perche' (privilegi mancanti, o profilo senza porte UDP). */
  udpSaltata: string | null;
  errori: string[];
}

export interface EsitoProfilo {
  profilo: ProfiloScansione["id"];
  host: EsitoHost[];
  /** Script citati dal profilo e non presenti sulla macchina: si dicono, non si nascondono. */
  scriptMancanti: string[];
  osDetectionSaltata: boolean;
  registro: string[];
}

async function unaFase(
  ip: string,
  args: string[],
  tettoByteOutput: number,
  timeoutMs: number,
  log: (m: string) => void
): Promise<{ risultato: NmapResult | null; errore: string | null }> {
  const completi = [...args, "-oX", "-", ip];
  log(`nmap ${completi.join(" ")}`);
  try {
    const { stdout } = await execFileAsync("nmap", completi, { signal: segnaleGiro(), timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 });
    const risultati = parseNmapXml(stdout, { tettoByteOutput });
    return { risultato: risultati.length > 0 ? risultati[0] : null, errore: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { risultato: null, errore: msg.slice(0, 200) };
  }
}

/** Fonde due risultati nmap dello stesso IP (fase TCP + fase UDP). */
function fondi(a: NmapResult | null, b: NmapResult | null): NmapResult | null {
  if (!a) return b;
  if (!b) return a;
  const porte = [...a.ports];
  for (const p of b.ports) {
    if (!porte.some((m) => m.port === p.port && m.protocol === p.protocol)) porte.push(p);
  }
  return {
    ...a,
    ports: porte.sort((x, y) => x.port - y.port),
    os: a.os ?? b.os,
    mac: a.mac ?? b.mac,
    hostScripts: [...(a.hostScripts ?? []), ...(b.hostScripts ?? [])],
    snmpHostname: a.snmpHostname ?? b.snmpHostname,
    snmpSysDescr: a.snmpSysDescr ?? b.snmpSysDescr,
    snmpSysObjectID: a.snmpSysObjectID ?? b.snmpSysObjectID,
  };
}

/**
 * Esegue il profilo sugli IP dati. Non scrive niente: la persistenza la fa il
 * chiamante, cosi' questa funzione resta provabile iniettando `esegui`.
 */
export async function eseguiProfilo(
  profilo: ProfiloScansione,
  ips: string[],
  opts?: { onLog?: (m: string) => void }
): Promise<EsitoProfilo> {
  const registro: string[] = [];
  const log = (m: string) => {
    registro.push(m);
    opts?.onLog?.(m);
  };

  const disponibili = await scriptDisponibili();
  const mancanti = scriptMancanti(profilo, disponibili);
  if (mancanti.length > 0) {
    log(`Script non presenti su questa macchina, saltati: ${mancanti.join(", ")}`);
  }
  const privilegi = haPrivilegi();
  const osSaltata = profilo.osDetection && !privilegi;
  if (osSaltata) {
    log("Riconoscimento del sistema operativo (-O) saltato: il processo non ha i privilegi per i raw socket");
  }

  const argsTcp = argomentiTcp(profilo, { privilegi, disponibili });
  const argsUdp = argomentiUdp(profilo, { privilegi, disponibili });
  const motivoUdp = argsUdp
    ? null
    : profilo.udp.length === 0
      ? "il profilo non ha porte UDP"
      : "il processo non ha i privilegi per -sU";
  if (motivoUdp) log(`Fase UDP saltata: ${motivoUdp}`);

  /* Il timeout del processo deve stare oltre `--host-timeout`, altrimenti lo
   * uccidiamo noi prima che nmap chiuda l'XML e perdiamo tutto il giro. */
  const timeoutMs = (profilo.hostTimeoutS + 60) * 1000;

  const host: EsitoHost[] = [];
  const coda = [...ips];
  async function lavoratore(): Promise<void> {
    for (;;) {
      const ip = coda.shift();
      if (!ip) return;
      const errori: string[] = [];
      const tcp = await unaFase(ip, argsTcp, profilo.tettoByteOutput, timeoutMs, log);
      if (tcp.errore) errori.push(`TCP: ${tcp.errore}`);
      let udp: NmapResult | null = null;
      if (argsUdp) {
        const r = await unaFase(ip, argsUdp, profilo.tettoByteOutput, timeoutMs, log);
        if (r.errore) errori.push(`UDP: ${r.errore}`);
        udp = r.risultato;
      }
      const risultato = fondi(tcp.risultato, udp);
      const rilievi = risultato ? rilieviDaRisultato(risultato, profilo.id) : [];
      const fatti = risultato ? fattiDaRisultato(risultato) : {};
      log(
        risultato
          ? `${ip}: ${risultato.ports.length} porte, ${rilievi.length} script con risposta`
          : `${ip}: nessuna risposta`
      );
      host.push({ ip, risultato, rilievi, fatti, udpSaltata: motivoUdp, errori });
    }
  }
  await Promise.all(Array.from({ length: Math.min(HOST_PARALLELI, ips.length) }, () => lavoratore()));

  return { profilo: profilo.id, host, scriptMancanti: mancanti, osDetectionSaltata: osSaltata, registro };
}
