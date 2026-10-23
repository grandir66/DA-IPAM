/**
 * I parametri di Opzioni (tavola del 22/10, oggetti 14-19): numeri, elenchi e percorsi che regolano le funzioni, presi
 * dalle schede Scansione, Notifiche e Alert sicurezza. I dati (profilo Nmap, canali, IP e account nostri, URL e password)
 * restano nelle loro schede: qui solo ciò che ha un valore di serie.
 *
 * Ogni parametro scrive la STESSA chiave che legge chi lo usa (scanner, notifiche), con gli stessi limiti della rotta
 * della scheda; «chi l'ha cambiato» sta accanto, in `opzioni.cambio.<id>` delle impostazioni dell'hub. «Torna a …» toglie
 * la chiave: chi la legge ricade da sé sul valore di serie.
 *
 * I parametri `fisso` si leggono e basta: i tre numeri della scansione veloce, che lo scanner prende SOLO dal file
 * dell'appliance (la vecchia scheda li salvava nel database, ma nessuno li leggeva: scoperto il 23/10), le soglie della
 * pulizia degli host e il limite di errori di MDM, fissi nel codice.
 */
import { deleteSetting, getSetting, setSetting } from "@/lib/db-hub";
import { oraUtc } from "@/lib/topology/letture/interruttori";
import { CHIAVI_NOTIFICHE, DEFAULT_RETENTION_DAYS } from "@/lib/notifications/config";
import { DEFAULT_POLICY } from "@/lib/notifications/policy";
import { ALERT_CATEGORIES } from "@/lib/integrations/wazuh-alerts";
import {
  NETWORK_DISCOVERY_QUICK_TCP_PORTS, getNetworkDiscoveryQuickConcurrency, getNetworkDiscoveryQuickExecMs,
  getNetworkDiscoveryQuickHostTimeoutSeconds,
} from "@/lib/scanner/ports";
import { GIORNI_ASSENZA_ARCHIVIO } from "@/lib/hosts/pulizia";
import { GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE } from "@/lib/hosts/pulizia-archivio";
import { MDM_MAX_ERRORI_CONSECUTIVI } from "@/lib/integrations/mdm-config";
import { ErroreOpzione, type Opzione, type Scelta, type StatoOpzione } from "./tipi";

// ── Chi l'ha cambiato ────────────────────────────────────────────────────────

export const chiaveSegno = (id: string): string => `opzioni.cambio.${id}`;

/** Il segno del cambio; illeggibile = nessun nome (la riga dice comunque che il valore non è quello di serie). */
function segno(id: string): { da: string | null; il: string | null } {
  const testo = getSetting(chiaveSegno(id));
  if (!testo) return { da: null, il: null };
  try {
    const o = JSON.parse(testo) as { da?: unknown; il?: unknown } | null;
    return { da: typeof o?.da === "string" ? o.da : null, il: typeof o?.il === "string" ? o.il : null };
  } catch {
    return { da: null, il: null };
  }
}

// ── I parametri che si cambiano ──────────────────────────────────────────────

interface DefParametro {
  id: string;
  /** La chiave delle impostazioni dell'hub che legge chi usa il parametro. */
  chiave: string;
  nome: string;
  cosa: string;
  sezione: string;
  forma: "numero" | "elenco" | "testo";
  unita?: string;
  min?: number;
  max?: number;
  scelte?: Scelta[];
  /** Il valore che vale senza la chiave, nella forma in cui si scrive. */
  valoreDiSerie: string;
  diSerie: string;
  configura?: { href: string; etichetta: string };
  /** Controlla e normalizza il valore chiesto; lancia `ErroreOpzione` col motivo. */
  normalizza(valore: string): string;
}

function intero(valore: string, min: number, max: number, nome: string): string {
  const t = valore.trim();
  if (!/^\d+$/.test(t)) throw new ErroreOpzione(`${nome}: serve un numero intero`, 400);
  const n = Number(t);
  if (n < min || n > max) throw new ErroreOpzione(`${nome}: da ${min} a ${max}`, 400);
  return String(n);
}

/** «22, 80-90» o una porta per riga → «22,80-90». Porte 1-65535, intervalli in salita. */
export function normalizzaPorte(valore: string): string {
  const parti = valore.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  if (parti.length === 0) throw new ErroreOpzione("Porte TCP: almeno una porta (per l'elenco di serie: «Torna all'elenco di serie»)", 400);
  const buone: string[] = [];
  for (const p of parti) {
    const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(p);
    const a = m ? Number(m[1]) : NaN;
    const b = m?.[2] !== undefined ? Number(m[2]) : a;
    if (!m || a < 1 || b > 65535 || b < a) throw new ErroreOpzione(`Porte TCP: «${p}» non è una porta (1-65535) né un intervallo come 8000-8100`, 400);
    if (!buone.includes(p)) buone.push(p);
  }
  return buone.join(",");
}

const ID_CATEGORIE = new Set(ALERT_CATEGORIES.map((c) => c.id));

const PARAMETRI: readonly DefParametro[] = [
  {
    id: "parametro.quick_scan_tcp_ports",
    chiave: "quick_scan_tcp_ports",
    nome: "Porte TCP provate",
    cosa: "le porte che la scansione veloce prova su ogni host",
    sezione: "Scansione veloce delle reti",
    forma: "elenco",
    valoreDiSerie: NETWORK_DISCOVERY_QUICK_TCP_PORTS,
    diSerie: `elenco di serie (${NETWORK_DISCOVERY_QUICK_TCP_PORTS.split(",").length} porte)`,
    normalizza: normalizzaPorte,
  },
  {
    id: "parametro.naabu_bin_path",
    chiave: "naabu_bin_path",
    nome: "Percorso di Naabu",
    cosa: "serve solo con «Naabu prima di Nmap» acceso; vuoto = lo cerca nel sistema",
    sezione: "Scansione veloce delle reti",
    forma: "testo",
    valoreDiSerie: "",
    diSerie: "vuoto",
    normalizza(valore) {
      const t = valore.trim();
      if (t === "") return "";
      if (t.length > 500 || !t.startsWith("/") || /[\x00-\x1f]/.test(t)) {
        throw new ErroreOpzione("Percorso di Naabu: un percorso assoluto, come /usr/local/bin/naabu", 400);
      }
      return t;
    },
  },
  {
    id: "parametro.notify_immediate_min_level",
    chiave: CHIAVI_NOTIFICHE.immediateMinLevel,
    nome: "Livello per invio immediato",
    cosa: "un allarme da questo livello in su parte subito, qualunque sia la categoria",
    sezione: "Notifiche",
    forma: "numero",
    min: 1,
    max: 16,
    valoreDiSerie: String(DEFAULT_POLICY.immediateMinLevel),
    diSerie: String(DEFAULT_POLICY.immediateMinLevel),
    configura: { href: "/settings?tab=notifiche", etichetta: "Canali ›" },
    normalizza: (v) => intero(v, 1, 16, "Livello per invio immediato"),
  },
  {
    id: "parametro.notify_immediate_categories",
    chiave: CHIAVI_NOTIFICHE.immediateCategories,
    nome: "Categorie con invio immediato",
    cosa: "partono subito qualunque sia il livello",
    sezione: "Notifiche",
    forma: "elenco",
    scelte: ALERT_CATEGORIES.map((c) => ({ valore: c.id, etichetta: c.labelIt })),
    valoreDiSerie: DEFAULT_POLICY.immediateCategories.join(","),
    diSerie: DEFAULT_POLICY.immediateCategories
      .map((id) => ALERT_CATEGORIES.find((c) => c.id === id)?.labelIt ?? id)
      .join(", "),
    normalizza(valore) {
      const ids = [...new Set(valore.split(",").map((x) => x.trim()).filter(Boolean))];
      // Vuoto non si scrive: la notifica lo leggerebbe come «di serie», e la pagina direbbe il falso.
      if (ids.length === 0) throw new ErroreOpzione("Categorie con invio immediato: almeno una", 400);
      const ignote = ids.filter((id) => !ID_CATEGORIE.has(id));
      if (ignote.length > 0) throw new ErroreOpzione(`Categorie sconosciute: ${ignote.join(", ")}`, 400);
      return ids.join(",");
    },
  },
  {
    id: "parametro.notify_digest_interval_minutes",
    chiave: CHIAVI_NOTIFICHE.digestIntervalMinutes,
    nome: "Riepilogo ogni",
    cosa: "gli altri allarmi arrivano raccolti",
    sezione: "Notifiche",
    forma: "numero",
    unita: "minuti",
    min: 5,
    max: 1440,
    valoreDiSerie: String(DEFAULT_POLICY.digestIntervalMinutes),
    diSerie: `${DEFAULT_POLICY.digestIntervalMinutes} minuti`,
    normalizza: (v) => intero(v, 5, 1440, "Riepilogo ogni"),
  },
  {
    id: "parametro.notify_retention_days",
    chiave: CHIAVI_NOTIFICHE.retentionDays,
    nome: "Conservazione degli eventi",
    cosa: "gli eventi di sicurezza più vecchi si cancellano",
    sezione: "Alert sicurezza",
    forma: "numero",
    unita: "giorni",
    min: 1,
    max: 365,
    valoreDiSerie: String(DEFAULT_RETENTION_DAYS),
    diSerie: `${DEFAULT_RETENTION_DAYS} giorni`,
    normalizza: (v) => intero(v, 1, 365, "Conservazione degli eventi"),
  },
];

/** Le chiavi delle impostazioni coperte da un parametro che si cambia (per la prova di completezza). */
export const CHIAVI_PARAMETRI: readonly string[] = PARAMETRI.map((p) => p.chiave);

function statoParametro(p: DefParametro): StatoOpzione {
  const grezzo = getSetting(p.chiave);
  if (grezzo === null || grezzo.trim() === "") {
    return { acceso: true, da: null, il: null, valore: p.valoreDiSerie, esito: { tipo: "neutro", testo: "di serie" } };
  }
  const s = segno(p.id);
  const testo = s.da ? `cambiato da ${s.da}` : "cambiato dalla scheda di prima";
  return { acceso: true, da: s.da, il: s.il, valore: grezzo.trim(), cambiato: true, esito: { tipo: "neutro", testo } };
}

function opzioneParametro(p: DefParametro): Opzione {
  return {
    id: p.id,
    gruppo: "parametri",
    nome: p.nome,
    cosa: p.cosa,
    valePer: "hub",
    forma: p.forma,
    diSerie: p.diSerie,
    scelte: p.scelte,
    configura: p.configura,
    parametro: { sezione: p.sezione, unita: p.unita, min: p.min, max: p.max },
    leggi: () => statoParametro(p),
    cambia(r, chi) {
      if (r.diSerie) {
        deleteSetting(p.chiave);
        deleteSetting(chiaveSegno(p.id));
        return;
      }
      if (r.valore === undefined) throw new ErroreOpzione("È un parametro: indica il valore", 400);
      const v = p.normalizza(r.valore);
      // Il valore vuoto di un testo è il suo di serie: si toglie la chiave, non si scrive «».
      if (v === "") {
        deleteSetting(p.chiave);
        deleteSetting(chiaveSegno(p.id));
        return;
      }
      setSetting(p.chiave, v);
      setSetting(chiaveSegno(p.id), JSON.stringify({ da: chi, il: oraUtc(new Date()) }));
    },
  };
}

// ── I parametri fissi ────────────────────────────────────────────────────────

interface DefFisso {
  id: string;
  nome: string;
  cosa: string;
  sezione: string;
  unita: string;
  valePer: "cliente" | "hub";
  valore: () => number;
  diSerie: string;
  /** Il testo della colonna «chi»: da file, di serie, fisso nel codice. */
  stato: () => string;
  dove: string;
}

/** I tre numeri della scansione veloce: valgono quelli del file, se c'è la riga, altrimenti quelli di serie. */
function daFile(variabile: string): () => string {
  return () => (process.env[variabile]?.trim() ? `dal file (${variabile})` : "di serie");
}

const FISSI: readonly DefFisso[] = [
  {
    id: "parametro.quick_scan_concurrency",
    nome: "Host in parallelo",
    cosa: "quanti indirizzi la scansione veloce prova insieme",
    sezione: "Scansione veloce delle reti",
    unita: "host",
    valePer: "hub",
    valore: getNetworkDiscoveryQuickConcurrency,
    diSerie: "12 host",
    stato: daFile("DA_INVENT_NMAP_DISCOVERY_CONCURRENCY"),
    dove: "Riga DA_INVENT_NMAP_DISCOVERY_CONCURRENCY nel file .env.local dell'appliance (da 1 a 24), poi riavvio del servizio.",
  },
  {
    id: "parametro.quick_scan_host_timeout_s",
    nome: "Attesa per host",
    cosa: "oltre questo tempo l'host è «non risponde»",
    sezione: "Scansione veloce delle reti",
    unita: "s",
    valePer: "hub",
    valore: getNetworkDiscoveryQuickHostTimeoutSeconds,
    diSerie: "10 s",
    stato: daFile("DA_INVENT_NMAP_DISCOVERY_QUICK_TIMEOUT_S"),
    dove: "Riga DA_INVENT_NMAP_DISCOVERY_QUICK_TIMEOUT_S nel file .env.local dell'appliance (da 5 a 20 secondi), poi riavvio del servizio.",
  },
  {
    id: "parametro.quick_scan_exec_limit_ms",
    nome: "Tempo massimo di Nmap",
    cosa: "per ogni host della scansione veloce",
    sezione: "Scansione veloce delle reti",
    unita: "s",
    valePer: "hub",
    valore: () => Math.round(getNetworkDiscoveryQuickExecMs() / 1000),
    diSerie: "22 s",
    stato: daFile("DA_INVENT_NMAP_DISCOVERY_EXEC_MS"),
    dove: "Riga DA_INVENT_NMAP_DISCOVERY_EXEC_MS nel file .env.local dell'appliance, in millisecondi (da 10000 a 90000), poi riavvio del servizio.",
  },
  {
    id: "parametro.pulizia_giorni_assenza",
    nome: "Assenza prima dell'archivio",
    cosa: "un host offline da più giorni va in archivio",
    sezione: "Pulizia degli host assenti",
    unita: "giorni",
    valePer: "cliente",
    valore: () => GIORNI_ASSENZA_ARCHIVIO,
    diSerie: `${GIORNI_ASSENZA_ARCHIVIO} giorni`,
    stato: () => "fisso nel codice",
    dove: "Fisso nel codice (decisione del 20/10): per cambiarlo serve una versione nuova.",
  },
  {
    id: "parametro.pulizia_giorni_archivio",
    nome: "Archivio prima della cancellazione",
    cosa: "dall'archivio un host si recupera fino a questa età",
    sezione: "Pulizia degli host assenti",
    unita: "giorni",
    valePer: "cliente",
    valore: () => GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE,
    diSerie: `${GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE} giorni`,
    stato: () => "fisso nel codice",
    dove: "Fisso nel codice (decisione del 20/10): per cambiarlo serve una versione nuova.",
  },
  {
    id: "parametro.mdm_max_errori",
    nome: "Errori di fila prima di spegnersi",
    cosa: "la sincronizzazione di MDM si spegne da sola dopo questi errori",
    sezione: "MDM Headwind",
    unita: "errori",
    valePer: "cliente",
    valore: () => MDM_MAX_ERRORI_CONSECUTIVI,
    diSerie: `${MDM_MAX_ERRORI_CONSECUTIVI} errori`,
    stato: () => "fisso nel codice",
    dove: "Fisso nel codice: per cambiarlo serve una versione nuova.",
  },
];

function opzioneFissa(f: DefFisso): Opzione {
  return {
    id: f.id,
    gruppo: "parametri",
    nome: f.nome,
    cosa: f.cosa,
    valePer: f.valePer,
    forma: "fisso",
    diSerie: f.diSerie,
    dove: f.dove,
    parametro: { sezione: f.sezione, unita: f.unita },
    leggi: () => ({ acceso: true, da: null, il: null, valore: String(f.valore()), esito: { tipo: "neutro", testo: f.stato() } }),
  };
}

/** Il gruppo «Parametri e soglie», nell'ordine della tavola: per sezione, i cambiabili prima dei fissi. */
export function opzioniParametri(): Opzione[] {
  const tutte = [...PARAMETRI.map(opzioneParametro), ...FISSI.map(opzioneFissa)];
  const sezioni = [...new Set(tutte.map((o) => o.parametro?.sezione ?? ""))];
  return sezioni.flatMap((s) => tutte.filter((o) => o.parametro?.sezione === s));
}
