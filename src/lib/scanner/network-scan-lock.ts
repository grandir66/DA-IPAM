/**
 * Un giro alla volta per rete (T3-18, INV-1).
 *
 * PERCHE' ESISTE: due giri di discovery sulla stessa rete dello stesso tenant
 * scrivevano insieme sugli stessi host; il giro partito prima poteva spegnere
 * host visti dal secondo. Le partenze arrivano da più strade (scheduler, «Esegui
 * ora», pulsanti della pagina rete, l'aggiornamento automatico della pagina),
 * quindi il controllo sta nel punto in cui TUTTE passano: `discoverNetwork`.
 *
 * Il lucchetto vive in memoria, su `globalThis` con una chiave `Symbol.for`: il
 * modulo può essere caricato due volte nello stesso processo (tsx, bundle delle
 * rotte, NUC-5) e le due copie devono vedere lo stesso lucchetto. Il processo è
 * uno solo: con uno scheduler in un processo separato servirebbe un lucchetto
 * sul database.
 *
 * Il lucchetto si rilascia SOLO alla chiusura vera del giro (`done` di
 * `discoverNetwork`). Non c'è un timeout che lo liberi: un giro che scrive
 * ancora non deve trovarsi accanto un secondo giro. Un giro troppo lungo fa
 * scrivere una sola riga d'allarme, e il lucchetto resta preso.
 */

/** Soglia predefinita dell'allarme: il doppio del giro più lungo misurato (~49 min). */
export const SOGLIA_ALLARME_MINUTI_PREDEFINITA = 100;
/** Chiave in `tenant_settings` per cambiare la soglia di un tenant. */
export const CHIAVE_SOGLIA_ALLARME = "scan_lock_alarm_minutes";

export interface GiroSullaRete {
  scanId: string;
  scanType: string;
  /** Millisecondi epoch della partenza. */
  startedAtMs: number;
  /** Allarme di durata già scritto per questo giro (una riga sola). */
  allarmato: boolean;
}

/** Il giro che occupa la rete, nella forma che va al chiamante e all'interfaccia. */
export interface GiroOccupante {
  scanId: string;
  scanType: string;
  /** ISO 8601 UTC. */
  startedAt: string;
}

interface StatoLucchetto {
  giri: Map<string, GiroSullaRete>;
}

const CHIAVE_STATO = Symbol.for("da-ipam.scanner.network-lock");

function stato(): StatoLucchetto {
  const g = globalThis as unknown as Record<symbol, StatoLucchetto | undefined>;
  return (g[CHIAVE_STATO] ??= { giri: new Map() });
}

function chiave(tenantCode: string, networkId: number): string {
  return `${tenantCode}:${networkId}`;
}

const CODICE_SCAN_IN_CORSO = "SCAN_IN_CORSO";

/**
 * La rete è occupata da un altro giro. Si riconosce con `isScanInCorso`, non con
 * `instanceof`: con due copie del modulo le classi sono due.
 */
export class ScanInCorsoError extends Error {
  readonly codice = CODICE_SCAN_IN_CORSO;
  readonly giro: GiroOccupante;
  readonly networkId: number;

  constructor(networkId: number, giro: GiroOccupante) {
    super(`Rete ${networkId}: scansione ${giro.scanId} (${giro.scanType}) già in corso dalle ${giro.startedAt}`);
    this.name = "ScanInCorsoError";
    this.networkId = networkId;
    this.giro = giro;
  }
}

export function isScanInCorso(e: unknown): e is ScanInCorsoError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { codice?: unknown }).codice === CODICE_SCAN_IN_CORSO &&
    typeof (e as { giro?: unknown }).giro === "object"
  );
}

function occupante(g: GiroSullaRete): GiroOccupante {
  return { scanId: g.scanId, scanType: g.scanType, startedAt: new Date(g.startedAtMs).toISOString() };
}

export interface OpzioniLucchetto {
  /** Orologio (ms epoch): iniettato dalle prove. */
  ora?: number;
  /** Minuti oltre i quali un giro ancora in corso fa scrivere l'allarme. */
  sogliaAllarmeMinuti?: number;
}

/**
 * Prende la rete per un giro. Se è già occupata lancia `ScanInCorsoError` e,
 * se il giro che la tiene ha superato la soglia, scrive UNA riga d'allarme
 * (una per giro) senza liberare la rete.
 *
 * Restituisce la funzione di rilascio: idempotente, e libera solo se la rete è
 * ancora tenuta da QUESTO giro.
 */
export function prendiRete(
  tenantCode: string,
  networkId: number,
  giro: { scanId: string; scanType: string },
  opzioni: OpzioniLucchetto = {},
): () => void {
  const ora = opzioni.ora ?? Date.now();
  const k = chiave(tenantCode, networkId);
  const giri = stato().giri;
  const presente = giri.get(k);
  if (presente) {
    const soglia = opzioni.sogliaAllarmeMinuti ?? SOGLIA_ALLARME_MINUTI_PREDEFINITA;
    const minuti = Math.floor((ora - presente.startedAtMs) / 60_000);
    if (!presente.allarmato && minuti > soglia) {
      presente.allarmato = true;
      console.error(
        `[Scansioni] ALLARME: il giro ${presente.scanId} (${presente.scanType}) sulla rete ${networkId} ` +
          `del tenant ${tenantCode} è in corso da ${minuti} minuti (soglia ${soglia}). La rete resta ` +
          "occupata finché il giro non si chiude: se è appeso, il processo va riavviato.",
      );
    }
    throw new ScanInCorsoError(networkId, occupante(presente));
  }

  const mio: GiroSullaRete = { scanId: giro.scanId, scanType: giro.scanType, startedAtMs: ora, allarmato: false };
  giri.set(k, mio);
  return () => {
    if (giri.get(k) === mio) giri.delete(k);
  };
}

/** Il giro che occupa la rete, se c'è (diagnostica e prove). */
export function giroSullaRete(tenantCode: string, networkId: number): GiroOccupante | undefined {
  const g = stato().giri.get(chiave(tenantCode, networkId));
  return g ? occupante(g) : undefined;
}

/** Legge la soglia dal valore grezzo di `tenant_settings`; valori non validi → predefinita. */
export function sogliaAllarmeDa(valore: string | null | undefined): number {
  const n = Number(valore);
  return Number.isFinite(n) && n > 0 ? n : SOGLIA_ALLARME_MINUTI_PREDEFINITA;
}

const NOMI_TIPI: Record<string, string> = {
  ping: "Ping",
  fast: "Scansione veloce",
  snmp: "SNMP",
  nmap: "Nmap",
  windows: "WinRM (Windows)",
  ssh: "SSH (Linux)",
  network_discovery: "Scoperta rete",
  ipam_full: "IPAM completo",
  credential_validate: "Validazione credenziali",
  scan_icmp: "ICMP",
  scan_nmap_base: "Nmap base",
  scan_snmp_verify: "SNMP verify",
  scan_full: "Scan completo",
  scan_naabu: "Naabu",
};

/**
 * Corpo della risposta 409 per una partenza rifiutata: il messaggio è già
 * pronto per l'interfaccia (ora italiana), i campi servono a chi lo legge da
 * macchina.
 */
export function corpoScanInCorso(giro: GiroOccupante | undefined): {
  error: string;
  codice: "scan_in_corso";
  scan_in_corso: { id: string; scan_type: string; started_at: string } | null;
} {
  if (!giro) {
    return {
      error: "Scansione non avviata: sulla rete c'è già una scansione in corso. Riprova quando è finita.",
      codice: "scan_in_corso",
      scan_in_corso: null,
    };
  }
  const nome = NOMI_TIPI[giro.scanType] ?? giro.scanType;
  let orario = "";
  try {
    orario = new Date(giro.startedAt).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Rome",
    });
  } catch {
    orario = "";
  }
  const quando = orario ? `, partita alle ${orario}` : "";
  return {
    error: `Scansione non avviata: su questa rete è già in corso «${nome}»${quando}. Riprova quando è finita.`,
    codice: "scan_in_corso",
    scan_in_corso: { id: giro.scanId, scan_type: giro.scanType, started_at: giro.startedAt },
  };
}
