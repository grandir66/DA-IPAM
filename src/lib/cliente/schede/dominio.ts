import type Database from "better-sqlite3";
import { nelCliente, type ContestoCliente } from "../contesto";
import { conQuanti, fraseRilievo, rilievoNascosto } from "../frasi-dominio";
import type { Gravita, RiquadroCliente, SchedaCliente, VoceAttenzione } from "../registro";

export interface StatoDominio {
  punteggio: number | null;
  unMeseFa: number | null;
  controllatoIl: string | null;
  aree: Array<{ nome: string; punteggio: number }>;
  rilievi: Array<{ gravita: Gravita; testo: string; quanti: number; nomi: string[] }>;
  /** Rilievi gravi del giro, anche oltre i dieci mostrati. */
  graviTotali: number;
}

export interface ProblemaAccesso {
  utente: string;
  tipo: "bloccato" | "falliti";
  quanti: number;
  da: string | null;
  ultima: string;
  motivo: string | null;
}

const GIORNI_MESE = 25;
const ORE_ACCESSO = 24;
const FALLITI_MINIMI = 5;
const MASSIMO_RILIEVI = 10;
const MASSIMO_PROBLEMI = 20;
const EVENTI_FALLITI = new Set([4625, 4771, 4776]);

const AREE = [
  { colonna: "score_stale", nome: "Account fermi" },
  { colonna: "score_privileged", nome: "Account con privilegi" },
  { colonna: "score_trust", nome: "Fiducie tra domini" },
  { colonna: "score_anomaly", nome: "Anomalie" },
] as const;

const PESO_SEVERITY: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

interface RigaRun {
  id: number;
  started_at: string;
  score_global: number | null;
  score_stale: number | null;
  score_privileged: number | null;
  score_trust: number | null;
  score_anomaly: number | null;
}

interface RigaRilievo {
  rule_id: string | null;
  severity: string;
  title: string;
  object_count: number;
  sample_dns_json: string | null;
}

interface RigaEvento {
  account: string | null;
  event_id: number;
  postazione: string | null;
  ip: string | null;
  motivo: string | null;
  quando: string;
}

function testo(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function tabella(db: Database.Database, nome: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome);
}

/** I due livelli più alti sono gravi, il medio è attenzione, il resto è una nota. */
function gravitaDi(severity: string): Gravita {
  if (severity === "Critical" || severity === "High") return "grave";
  if (severity === "Medium") return "attenzione";
  return "nota";
}

/** Se c'è CN= si prende quel pezzo; altrimenti la voce così com'è. I doppi si tolgono. */
function nomiDa(raw: string | null): string[] {
  if (!testo(raw)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw as string);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const visti = new Set<string>();
  const nomi: string[] = [];
  for (const voce of parsed) {
    if (typeof voce !== "string") continue;
    const trovato = /CN=([^,]*)/i.exec(voce);
    const nome = (trovato ? trovato[1] : voce).trim();
    if (!nome || visti.has(nome)) continue;
    visti.add(nome);
    nomi.push(nome);
  }
  return nomi;
}

interface RilievoInterno {
  gravita: Gravita;
  testo: string;
  quanti: number;
  nomi: string[];
  peso: number;
}

function rilieviTutti(db: Database.Database, runId: number): RilievoInterno[] {
  const righe = db.prepare(
    "SELECT rule_id, severity, title, object_count, sample_dns_json FROM ad_health_findings WHERE run_id = ?",
  ).all(runId) as RigaRilievo[];
  return righe
    .filter((r) => !rilievoNascosto(r.rule_id))
    .map((r) => ({
      gravita: gravitaDi(r.severity),
      testo: fraseRilievo(r.rule_id, r.title),
      quanti: r.object_count,
      nomi: nomiDa(r.sample_dns_json),
      peso: PESO_SEVERITY[r.severity] ?? 4,
    }))
    .sort((a, b) => a.peso - b.peso || b.quanti - a.quanti);
}

/** null se non c'è un giro concluso bene. Il punteggio è un rischio: più alto è peggio. */
export function statoDominio(db: Database.Database): StatoDominio | null {
  if (!tabella(db, "ad_health_runs")) return null;
  const ultimo = db.prepare(`
    SELECT id, started_at, score_global, score_stale, score_privileged, score_trust, score_anomaly
    FROM ad_health_runs
    WHERE status = 'ok'
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `).get() as RigaRun | undefined;
  if (!ultimo) return null;

  const limite = new Date(Date.now() - GIORNI_MESE * 24 * 60 * 60 * 1000).toISOString();
  const vecchio = db.prepare(`
    SELECT score_global FROM ad_health_runs
    WHERE status = 'ok' AND started_at < ?
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `).get(limite) as { score_global: number | null } | undefined;

  const aree: StatoDominio["aree"] = [];
  for (const area of AREE) {
    const punteggio = ultimo[area.colonna];
    if (punteggio == null) continue;
    aree.push({ nome: area.nome, punteggio });
  }

  const tutti = tabella(db, "ad_health_findings") ? rilieviTutti(db, ultimo.id) : [];
  return {
    punteggio: ultimo.score_global,
    unMeseFa: vecchio?.score_global ?? null,
    controllatoIl: ultimo.started_at,
    aree,
    rilievi: tutti.slice(0, MASSIMO_RILIEVI).map((r) => ({ gravita: r.gravita, testo: r.testo, quanti: r.quanti, nomi: r.nomi })),
    graviTotali: tutti.filter((r) => r.gravita === "grave").length,
  };
}

/** Indirizzi con cui un server indica sé stesso. */
const SE_STESSO = new Set(["::1", "127.0.0.1", "localhost"]);

function daDi(evento: RigaEvento): string | null {
  const origine = testo(evento.postazione) ?? testo(evento.ip);
  return origine && SE_STESSO.has(origine.toLowerCase()) ? "il server di dominio stesso" : origine;
}

/** Ultime 24 ore. [] se la tabella non c'è. Gli account vuoti e quelli del computer (finiscono con $) non contano. */
export function problemiDiAccesso(db: Database.Database): ProblemaAccesso[] {
  if (!tabella(db, "dc_evento")) return [];
  const dal = new Date(Date.now() - ORE_ACCESSO * 60 * 60 * 1000).toISOString();
  const righe = db.prepare(`
    SELECT account, event_id, postazione, ip, motivo, quando
    FROM dc_evento
    WHERE quando >= ? AND event_id IN (4740, 4625, 4771, 4776)
    ORDER BY quando DESC
  `).all(dal) as RigaEvento[];

  const gruppi = new Map<string, RigaEvento[]>();
  for (const riga of righe) {
    const utente = testo(riga.account);
    if (!utente || utente.endsWith("$")) continue;
    const lista = gruppi.get(utente) ?? [];
    lista.push(riga);
    gruppi.set(utente, lista);
  }

  const problemi: ProblemaAccesso[] = [];
  for (const [utente, eventi] of gruppi) {
    const bloccati = eventi.filter((e) => e.event_id === 4740);
    const falliti = eventi.filter((e) => EVENTI_FALLITI.has(e.event_id));
    if (bloccati.length > 0) {
      const ultimo = bloccati[0] as RigaEvento;
      problemi.push({
        utente,
        tipo: "bloccato",
        quanti: bloccati.length,
        da: daDi(ultimo),
        ultima: ultimo.quando,
        motivo: testo(ultimo.motivo),
      });
      continue;
    }
    if (falliti.length >= FALLITI_MINIMI) {
      const ultimo = falliti[0] as RigaEvento;
      problemi.push({
        utente,
        tipo: "falliti",
        quanti: falliti.length,
        da: daDi(ultimo),
        ultima: ultimo.quando,
        motivo: testo(ultimo.motivo),
      });
    }
  }

  return problemi
    .sort((a, b) => {
      if (a.tipo !== b.tipo) return a.tipo === "bloccato" ? -1 : 1;
      return b.quanti - a.quanti || a.utente.localeCompare(b.utente, "it");
    })
    .slice(0, MASSIMO_PROBLEMI);
}

export interface Accessi24Ore {
  /** 24 elementi, dalla più vecchia all'ora in corso; `ora` è l'ora italiana, «09». */
  ore: Array<{ ora: string; falliti: number; blocchi: number }>;
  falliti: number;
  blocchi: number;
  /** Gli account con più accessi falliti (al più 5). */
  chi: Array<{ utente: string; falliti: number; blocchi: number }>;
  /** Le postazioni da cui partono (al più 5); il nome dell'apparato se l'indirizzo è noto. */
  daDove: Array<{ origine: string; falliti: number }>;
  /** Falliti di cui il server di dominio non dice la provenienza. */
  senzaOrigine: number;
}

const ORA_MS = 60 * 60 * 1000;

/**
 * Gli accessi falliti delle ultime 24 ore, ora per ora, con chi e da dove (Riccardo, 11/11/2026:
 * «su 7 giorni dicono poco: finestra inferiore e dettaglio migliore»). Fonte: gli eventi dei server
 * di dominio. Stesse esclusioni di `problemiDiAccesso`: account vuoti e account dei computer («…$»).
 * `null` se la tabella non c'è o nelle 24 ore non c'è nessun evento.
 */
export function accessi24Ore(db: Database.Database, ora: Date = new Date()): Accessi24Ore | null {
  if (!tabella(db, "dc_evento")) return null;
  const adesso = ora.getTime();
  const inizioOraCorrente = Math.floor(adesso / ORA_MS) * ORA_MS;
  const inizio = inizioOraCorrente - 23 * ORA_MS;
  const righe = db.prepare(`
    SELECT account, event_id, postazione, ip, motivo, quando
    FROM dc_evento
    WHERE quando >= ? AND event_id IN (4740, 4625, 4771, 4776)
  `).all(new Date(inizio).toISOString()) as RigaEvento[];

  const formatoOra = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" });
  const ore: Accessi24Ore["ore"] = Array.from({ length: 24 }, (_, i) => ({
    ora: formatoOra.format(inizio + i * ORA_MS),
    falliti: 0,
    blocchi: 0,
  }));
  const perUtente = new Map<string, { falliti: number; blocchi: number }>();
  const perOrigine = new Map<string, number>();
  let falliti = 0;
  let blocchi = 0;
  let senzaOrigine = 0;

  for (const riga of righe) {
    const utente = testo(riga.account);
    if (!utente || utente.endsWith("$")) continue;
    const istante = Date.parse(riga.quando);
    if (Number.isNaN(istante) || istante > adesso) continue;
    const indice = Math.floor((istante - inizio) / ORA_MS);
    const casella = ore[indice];
    if (!casella) continue;
    const suo = perUtente.get(utente) ?? { falliti: 0, blocchi: 0 };
    if (riga.event_id === 4740) {
      casella.blocchi += 1;
      blocchi += 1;
      suo.blocchi += 1;
    } else if (EVENTI_FALLITI.has(riga.event_id)) {
      casella.falliti += 1;
      falliti += 1;
      suo.falliti += 1;
      const origine = daDi(riga);
      if (origine) perOrigine.set(origine, (perOrigine.get(origine) ?? 0) + 1);
      else senzaOrigine += 1;
    }
    perUtente.set(utente, suo);
  }
  if (falliti === 0 && blocchi === 0) return null;

  const origini = [...perOrigine.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "it")).slice(0, 5);
  const nomi = nomiDegliIndirizzi(db, origini.map(([o]) => o));
  return {
    ore,
    falliti,
    blocchi,
    chi: [...perUtente.entries()]
      .map(([utente, n]) => ({ utente, ...n }))
      .sort((a, b) => b.falliti - a.falliti || b.blocchi - a.blocchi || a.utente.localeCompare(b.utente, "it"))
      .slice(0, 5),
    daDove: origini.map(([origine, n]) => ({ origine: nomi.get(origine) ?? origine, falliti: n })),
    senzaOrigine,
  };
}

/** Indirizzo → «nome (indirizzo)» per gli apparati che l'inventario conosce. */
function nomiDegliIndirizzi(db: Database.Database, origini: string[]): Map<string, string> {
  const mappa = new Map<string, string>();
  const ip = origini.filter((o) => /^\d{1,3}(\.\d{1,3}){3}$/.test(o));
  if (ip.length === 0 || !tabella(db, "hosts")) return mappa;
  const righe = db.prepare(
    `SELECT ip, custom_name, hostname FROM hosts WHERE ip IN (${ip.map(() => "?").join(",")})`,
  ).all(...ip) as Array<{ ip: string; custom_name: string | null; hostname: string | null }>;
  for (const r of righe) {
    const nome = testo(r.custom_name) ?? testo(r.hostname);
    if (nome) mappa.set(r.ip, `${nome} (${r.ip})`);
  }
  return mappa;
}

function contestoDominio(falliti: number): string {
  const n = falliti === 1 ? "1 accesso fallito" : `${falliti} accessi falliti`;
  return `più alto è peggio · ${n}`;
}

function riquadroDominio(c: ContestoCliente): RiquadroCliente {
  return nelCliente(c, (db) => {
    const stato = statoDominio(db);
    const problemi = problemiDiAccesso(db);
    const bloccati = problemi.filter((p) => p.tipo === "bloccato");
    // Lo stesso numero del grafico della casa: tutti i falliti delle 24 ore, non solo quelli di chi ne ha almeno 5.
    const falliti = accessi24Ore(db)?.falliti ?? 0;
    const gravi = stato?.graviTotali ?? 0;
    const aperti = bloccati.length + gravi;
    return {
      numero: stato?.punteggio == null ? "—" : String(stato.punteggio),
      unita: "di rischio su 100",
      contesto: contestoDominio(falliti),
      aperti,
      stato: gravi > 0 ? "grave" : bloccati.length > 0 ? "attenzione" : "a_posto",
    };
  });
}

/** Al più tre voci. Se i gravi sono di più, la terza riassume quelli non elencati. */
export function vociRilieviGravi(
  gravi: Array<{ testo: string; quanti: number }>,
  graviTotali: number,
): VoceAttenzione[] {
  const mostrati = graviTotali > 3 ? gravi.slice(0, 2) : gravi;
  const voci: VoceAttenzione[] = mostrati.map((rilievo) => ({
    gravita: "grave",
    testo: conQuanti(rilievo.quanti, rilievo.testo),
    href: "/cliente/dominio",
    scheda: "Dominio e accessi",
  }));
  if (graviTotali > 3) {
    voci.push({
      gravita: "grave",
      testo: `Altri ${graviTotali - 2} rilievi gravi nel dominio`,
      href: "/cliente/dominio",
      scheda: "Dominio e accessi",
    });
  }
  return voci;
}
function attenzioneDominio(c: ContestoCliente): VoceAttenzione[] {
  return nelCliente(c, (db) => {
    const voci: VoceAttenzione[] = [];
    for (const problema of problemiDiAccesso(db)) {
      if (problema.tipo !== "bloccato") continue;
      const volte = problema.quanti === 1 ? "1 volta" : `${problema.quanti} volte`;
      voci.push({
        gravita: "attenzione",
        testo: `${problema.utente} bloccato ${volte} oggi`,
        href: "/cliente/dominio",
        scheda: "Dominio e accessi",
      });
    }
    const stato = statoDominio(db);
    const gravi = (stato?.rilievi ?? []).filter((r) => r.gravita === "grave");
    voci.push(...vociRilieviGravi(gravi, stato?.graviTotali ?? 0));
    return voci;
  });
}

function dominioAttivo(c: ContestoCliente): boolean {
  return nelCliente(c, (db) => {
    if (!tabella(db, "ad_integrations")) return false;
    return !!db.prepare("SELECT 1 FROM ad_integrations LIMIT 1").get();
  });
}

export const schedaDominio: SchedaCliente = {
  id: "dominio",
  titolo: "Dominio e accessi",
  ordine: 40,
  icona: "Users",
  attiva: dominioAttivo,
  riquadro: riquadroDominio,
  attenzione: attenzioneDominio,
};
