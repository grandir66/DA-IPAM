/**
 * I parametri di Opzioni (tavola del 22/10, oggetti 14-19): numeri, elenchi e percorsi che regolano le funzioni, presi
 * dalle schede Scansione, Notifiche e Alert sicurezza. I dati (profilo Nmap, canali, IP e account nostri, URL e password)
 * restano nelle loro schede: qui solo ciò che ha un valore di serie.
 *
 * Ogni parametro scrive la STESSA chiave che legge chi lo usa (scanner, notifiche), con gli stessi limiti della rotta
 * della scheda; «chi l'ha cambiato» sta accanto, in `opzioni.cambio.<id>` delle impostazioni dell'hub. «Torna a …» toglie
 * la chiave: chi la legge ricade da sé sul valore di serie.
 *
 * Dal 23/10 (proposte approvate da Riccardo) si cambiano anche i tre numeri della scansione veloce (chiavi nuove,
 * `scanner/ports.ts`: Opzioni › file › di serie), le soglie della pulizia degli host e il limite di errori di MDM; questi
 * ultimi valgono per il cliente e stanno nelle sue impostazioni.
 */
import { deleteSetting, getSetting, setSetting } from "@/lib/db-hub";
import { deleteTenantSetting, getTenantSetting, setTenantSetting } from "@/lib/db-tenant";
import { oraUtc } from "@/lib/topology/letture/interruttori";
import { CHIAVI_NOTIFICHE, DEFAULT_RETENTION_DAYS } from "@/lib/notifications/config";
import { DEFAULT_POLICY } from "@/lib/notifications/policy";
import { ALERT_CATEGORIES } from "@/lib/integrations/wazuh-alerts";
import {
  CHIAVI_SCANSIONE_VELOCE, NETWORK_DISCOVERY_QUICK_TCP_PORTS, scansioneVeloceSenzaOpzioni,
} from "@/lib/scanner/ports";
import { GIORNI_ASSENZA_ARCHIVIO } from "@/lib/hosts/pulizia";
import { GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE } from "@/lib/hosts/pulizia-archivio";
import { CHIAVI_SOGLIE_PULIZIA, LIMITI_SOGLIE_PULIZIA } from "@/lib/hosts/soglie-pulizia";
import { CHIAVE_MDM_MAX_ERRORI, LIMITI_MDM_MAX_ERRORI, MDM_MAX_ERRORI_CONSECUTIVI } from "@/lib/integrations/mdm-config";
import { CHIAVI_SOGLIE, LIMITI_SOGLIE } from "@/lib/assegnatari/db";
import { SOGLIE_DI_SERIE } from "@/lib/assegnatari/proposta";
import { ErroreOpzione, type Opzione, type Scelta, type StatoOpzione } from "./tipi";

// ── Chi l'ha cambiato ────────────────────────────────────────────────────────

export const chiaveSegno = (id: string): string => `opzioni.cambio.${id}`;

/** Dove sta un parametro: le impostazioni dell'hub (vale per tutti i clienti) o quelle del cliente del contesto. */
interface Archivio {
  leggi(chiave: string): string | null;
  scrivi(chiave: string, valore: string): void;
  togli(chiave: string): void;
}
const HUB: Archivio = { leggi: getSetting, scrivi: setSetting, togli: deleteSetting };
const CLIENTE: Archivio = { leggi: getTenantSetting, scrivi: setTenantSetting, togli: deleteTenantSetting };

/** Il segno del cambio, accanto al valore; illeggibile = nessun nome (la riga dice comunque che non è di serie). */
function segno(a: Archivio, id: string): { da: string | null; il: string | null } {
  const testo = a.leggi(chiaveSegno(id));
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
  /** La chiave che legge chi usa il parametro, nelle impostazioni dell'hub o del cliente (`valePer`). */
  chiave: string;
  valePer?: "hub" | "cliente";
  nome: string;
  cosa: string;
  sezione: string;
  forma: "numero" | "elenco" | "testo";
  unita?: string;
  min?: number;
  max?: number;
  scelte?: Scelta[];
  /** Il valore che vale senza la chiave, come si mostra; una funzione se dipende dal file dell'appliance. */
  valoreDiSerie: string | (() => string);
  diSerie: string | (() => string);
  /** Il testo della colonna «chi» senza la chiave: «di serie», o «dal file (…)». */
  senzaChiave?: () => string;
  /** Dal valore salvato a quello che si mostra (i millisecondi di Nmap si mostrano in secondi). */
  mostra?: (salvato: string) => string;
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

/** I numeri della scansione veloce senza valore in Opzioni: valgono quelli del file, se c'è la riga, o quelli di serie. */
function daFile(variabile: string): () => string {
  return () => (process.env[variabile]?.trim() ? `dal file (${variabile})` : "di serie");
}

const valore = (x: string | (() => string)): string => (typeof x === "function" ? x() : x);

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
  {
    id: "parametro.quick_scan_concurrency",
    chiave: CHIAVI_SCANSIONE_VELOCE.hostParalleli,
    nome: "Host in parallelo",
    cosa: "quanti indirizzi la scansione veloce prova insieme: di più è più veloce e manda più traffico",
    sezione: "Scansione veloce delle reti",
    forma: "numero",
    unita: "host",
    min: 1,
    max: 24,
    valoreDiSerie: () => String(scansioneVeloceSenzaOpzioni().hostParalleli),
    diSerie: () => `${scansioneVeloceSenzaOpzioni().hostParalleli} host`,
    senzaChiave: daFile("DA_INVENT_NMAP_DISCOVERY_CONCURRENCY"),
    normalizza: (v) => intero(v, 1, 24, "Host in parallelo"),
  },
  {
    id: "parametro.quick_scan_host_timeout_s",
    chiave: CHIAVI_SCANSIONE_VELOCE.attesaHostS,
    nome: "Attesa per host",
    cosa: "oltre questo tempo l'host è «non risponde»",
    sezione: "Scansione veloce delle reti",
    forma: "numero",
    unita: "s",
    min: 5,
    max: 20,
    valoreDiSerie: () => String(scansioneVeloceSenzaOpzioni().attesaHostS),
    diSerie: () => `${scansioneVeloceSenzaOpzioni().attesaHostS} s`,
    senzaChiave: daFile("DA_INVENT_NMAP_DISCOVERY_QUICK_TIMEOUT_S"),
    normalizza: (v) => intero(v, 5, 20, "Attesa per host"),
  },
  {
    id: "parametro.quick_scan_exec_limit_ms",
    chiave: CHIAVI_SCANSIONE_VELOCE.tempoNmapMs,
    nome: "Tempo massimo di Nmap",
    cosa: "per ogni host della scansione veloce",
    sezione: "Scansione veloce delle reti",
    forma: "numero",
    unita: "s",
    min: 10,
    max: 90,
    valoreDiSerie: () => String(Math.round(scansioneVeloceSenzaOpzioni().tempoNmapMs / 1000)),
    diSerie: () => `${Math.round(scansioneVeloceSenzaOpzioni().tempoNmapMs / 1000)} s`,
    senzaChiave: daFile("DA_INVENT_NMAP_DISCOVERY_EXEC_MS"),
    // Si scrive in millisecondi, come lo legge lo scanner; si mostra in secondi.
    mostra: (salvato) => String(Math.round(Number(salvato) / 1000)),
    normalizza: (v) => String(Number(intero(v, 10, 90, "Tempo massimo di Nmap")) * 1000),
  },
  {
    id: "parametro.pulizia_giorni_assenza",
    chiave: CHIAVI_SOGLIE_PULIZIA.assenza,
    valePer: "cliente",
    nome: "Assenza prima dell'archivio",
    cosa: "un host offline da più giorni va in archivio la notte dopo, se la pulizia è accesa",
    sezione: "Pulizia degli host assenti",
    forma: "numero",
    unita: "giorni",
    min: LIMITI_SOGLIE_PULIZIA.min,
    max: LIMITI_SOGLIE_PULIZIA.max,
    valoreDiSerie: String(GIORNI_ASSENZA_ARCHIVIO),
    diSerie: `${GIORNI_ASSENZA_ARCHIVIO} giorni`,
    configura: { href: "/settings?tab=sistema", etichetta: "Anteprima ›" },
    normalizza: (v) => intero(v, LIMITI_SOGLIE_PULIZIA.min, LIMITI_SOGLIE_PULIZIA.max, "Assenza prima dell'archivio"),
  },
  {
    id: "parametro.pulizia_giorni_archivio",
    chiave: CHIAVI_SOGLIE_PULIZIA.archivio,
    valePer: "cliente",
    nome: "Archivio prima della cancellazione",
    cosa: "dall'archivio un host si recupera fino a questa età, poi si cancella per sempre",
    sezione: "Pulizia degli host assenti",
    forma: "numero",
    unita: "giorni",
    min: LIMITI_SOGLIE_PULIZIA.min,
    max: LIMITI_SOGLIE_PULIZIA.max,
    valoreDiSerie: String(GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE),
    diSerie: `${GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE} giorni`,
    normalizza: (v) => intero(v, LIMITI_SOGLIE_PULIZIA.min, LIMITI_SOGLIE_PULIZIA.max, "Archivio prima della cancellazione"),
  },
  {
    id: "parametro.mdm_max_errori",
    chiave: CHIAVE_MDM_MAX_ERRORI,
    valePer: "cliente",
    nome: "Errori di fila prima di spegnersi",
    cosa: "la sincronizzazione di MDM si spegne da sola dopo questi errori",
    sezione: "MDM Headwind",
    forma: "numero",
    unita: "errori",
    min: LIMITI_MDM_MAX_ERRORI.min,
    max: LIMITI_MDM_MAX_ERRORI.max,
    valoreDiSerie: String(MDM_MAX_ERRORI_CONSECUTIVI),
    diSerie: `${MDM_MAX_ERRORI_CONSECUTIVI} errori`,
    normalizza: (v) => intero(v, LIMITI_MDM_MAX_ERRORI.min, LIMITI_MDM_MAX_ERRORI.max, "Errori di fila prima di spegnersi"),
  },
  // Assegnatari proposti dagli accessi ai PC (piano 2026-10-23, decisione di Riccardo: soglie cambiabili).
  {
    id: "parametro.assegnatari_soglia",
    chiave: CHIAVI_SOGLIE.percentuale,
    valePer: "cliente",
    nome: "Quota per proporre",
    cosa: "si propone chi supera questa quota degli accessi di persone al PC",
    sezione: "Assegnatari proposti dagli accessi",
    forma: "numero",
    unita: "%",
    min: LIMITI_SOGLIE.percentuale.min,
    max: LIMITI_SOGLIE.percentuale.max,
    valoreDiSerie: String(SOGLIE_DI_SERIE.percentuale),
    diSerie: `più del ${SOGLIE_DI_SERIE.percentuale}%`,
    normalizza: (v) => intero(v, LIMITI_SOGLIE.percentuale.min, LIMITI_SOGLIE.percentuale.max, "Quota per proporre"),
  },
  {
    id: "parametro.assegnatari_minimo",
    chiave: CHIAVI_SOGLIE.minimo,
    valePer: "cliente",
    nome: "Accessi minimi",
    cosa: "sotto questi accessi di persone non si propone («pochi dati»)",
    sezione: "Assegnatari proposti dagli accessi",
    forma: "numero",
    unita: "accessi",
    min: LIMITI_SOGLIE.minimo.min,
    max: LIMITI_SOGLIE.minimo.max,
    valoreDiSerie: String(SOGLIE_DI_SERIE.minimo),
    diSerie: `${SOGLIE_DI_SERIE.minimo} accessi`,
    normalizza: (v) => intero(v, LIMITI_SOGLIE.minimo.min, LIMITI_SOGLIE.minimo.max, "Accessi minimi"),
  },
  {
    id: "parametro.assegnatari_giorni",
    chiave: CHIAVI_SOGLIE.giorni,
    valePer: "cliente",
    nome: "Periodo considerato",
    cosa: "gli accessi degli ultimi giorni che contano per la proposta",
    sezione: "Assegnatari proposti dagli accessi",
    forma: "numero",
    unita: "giorni",
    min: LIMITI_SOGLIE.giorni.min,
    max: LIMITI_SOGLIE.giorni.max,
    valoreDiSerie: String(SOGLIE_DI_SERIE.giorni),
    diSerie: `${SOGLIE_DI_SERIE.giorni} giorni`,
    normalizza: (v) => intero(v, LIMITI_SOGLIE.giorni.min, LIMITI_SOGLIE.giorni.max, "Periodo considerato"),
  },
];

/** Le chiavi delle impostazioni coperte da un parametro che si cambia (per la prova di completezza). */
export const CHIAVI_PARAMETRI: readonly string[] = PARAMETRI.map((p) => p.chiave);

const archivio = (p: DefParametro): Archivio => (p.valePer === "cliente" ? CLIENTE : HUB);

function statoParametro(p: DefParametro): StatoOpzione {
  const a = archivio(p);
  const grezzo = a.leggi(p.chiave);
  if (grezzo === null || grezzo.trim() === "") {
    const testo = p.senzaChiave ? p.senzaChiave() : "di serie";
    return { acceso: true, da: null, il: null, valore: valore(p.valoreDiSerie), esito: { tipo: "neutro", testo } };
  }
  const s = segno(a, p.id);
  const testo = s.da ? `cambiato da ${s.da}` : "cambiato dalla scheda di prima";
  const mostrato = p.mostra ? p.mostra(grezzo.trim()) : grezzo.trim();
  return { acceso: true, da: s.da, il: s.il, valore: mostrato, cambiato: true, esito: { tipo: "neutro", testo } };
}

function opzioneParametro(p: DefParametro): Opzione {
  return {
    id: p.id,
    gruppo: "parametri",
    nome: p.nome,
    cosa: p.cosa,
    valePer: p.valePer ?? "hub",
    forma: p.forma,
    diSerie: valore(p.diSerie),
    scelte: p.scelte,
    configura: p.configura,
    parametro: { sezione: p.sezione, unita: p.unita, min: p.min, max: p.max },
    leggi: () => statoParametro(p),
    cambia(r, chi) {
      const a = archivio(p);
      const togli = () => {
        a.togli(p.chiave);
        a.togli(chiaveSegno(p.id));
      };
      if (r.diSerie) return togli();
      if (r.valore === undefined) throw new ErroreOpzione("È un parametro: indica il valore", 400);
      const v = p.normalizza(r.valore);
      // Il valore vuoto di un testo è il suo di serie: si toglie la chiave, non si scrive «».
      if (v === "") return togli();
      a.scrivi(p.chiave, v);
      a.scrivi(chiaveSegno(p.id), JSON.stringify({ da: chi, il: oraUtc(new Date()) }));
    },
  };
}

/** Il gruppo «Parametri e soglie», nell'ordine della tavola: per sezione. */
export function opzioniParametri(): Opzione[] {
  const tutte = PARAMETRI.map(opzioneParametro);
  const sezioni = [...new Set(tutte.map((o) => o.parametro?.sezione ?? ""))];
  return sezioni.flatMap((s) => tutte.filter((o) => o.parametro?.sezione === s));
}
