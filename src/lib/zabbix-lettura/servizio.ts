/**
 * Il pannello Zabbix in sola lettura (passo 7.4-7.5): decide lo stato, legge il
 * centro quando serve e quando può, abbina gli host, prepara la pagina.
 *
 * Ordine degli stati (nessuna chiamata di rete prima di «ok» o «guasto»):
 * 1. **non acquistato** — senza il diritto all'opzione: niente DB, niente rete;
 * 2. **da configurare** — senza indirizzo e chiave: zero richieste;
 * 3. **spento** — configurato ma con l'interruttore spento: zero richieste;
 * 4. **guasto** — l'ultima lettura è fallita e l'attesa crescente (15 s … 5 min) non è
 *    finita, oppure la lettura di adesso fallisce; con l'ora dell'ultima lettura buona
 *    e nessun dato (né vecchio né inventato). «Cliente errato» è un guasto;
 * 5. **ok** — dati del centro, con i vecchi mostrati come vecchi.
 *
 * Una lettura buona resta in memoria 30 s per cliente (la stessa durata della cache del
 * centro): dieci pagine aperte costano una lettura. Le dipendenze si passano, così le
 * prove girano con un centro finto e contano le chiamate.
 */
import type Database from "better-sqlite3";
import type { HostDelCentro, RispostaFamiglie, RispostaStorico, RispostaValori } from "./api";
import { abbina, type EsitoAbbinamento, type RisultatoAbbinamento } from "./abbinamento";
import { abbinamentiSalvati, hostIpamPerIp, salvaAbbinamento } from "./abbinamenti-db";
import {
  leggiCentro,
  leggiFamiglie,
  leggiStorico,
  leggiValori,
  normalizzaBase,
  type LetturaCentro,
  type Lettore,
} from "./client";
import {
  chiaveLettura,
  leggiConfigLettura,
  registraFallimento,
  registraSuccesso,
  type ConfigLettura,
} from "./config";
import {
  attesaDopoFallimenti,
  disponibilitaDaMostrare,
  riepiloga,
  type HostMostrato,
  type PannelloZabbix,
  type ProxyLocale,
  type ProxyMostrato,
  type ValoreMostrato,
} from "./pannello";
import { ErroreLettura, type Trasporto } from "./trasporto";

export const DURATA_CACHE_MS = 30_000;
/** Una conferma d'abbinamento si appoggia a una lettura buona di al più 10 minuti fa. */
export const ETA_MASSIMA_CONFERMA_MS = 10 * 60_000;
export const PER_PAGINA = 50;

export interface DipendenzePannello {
  /** Chiave della cache in memoria: il codice del tenant. */
  tenant: string;
  db: Database.Database;
  /** Diritto all'opzione (oggi sempre vero: `opzioneAcquistata`). */
  acquistato: () => boolean;
  /** Il trasporto verso il centro per questa configurazione (TLS vero o finto). */
  trasporto: (cfg: ConfigLettura, chiave: string) => Trasporto;
  proxyLocale: (nomeConfigurato: string | null) => ProxyLocale;
  adesso: () => Date;
}

interface VoceCache {
  lettura: LetturaCentro;
  quando: number;
  /** Firma della configurazione: una configurazione nuova non usa la lettura di prima. */
  firma: string;
}
interface VoceValori {
  valori: RispostaValori;
  quando: number;
}

const cacheLetture = new Map<string, VoceCache>();
const cacheValori = new Map<string, VoceValori>();
const inVolo = new Map<string, Promise<LetturaCentro>>();

/** Famiglie e storico costano di più al centro: due e dieci minuti, come le sue cache. */
export const DURATA_FAMIGLIE_MS = 120_000;
export const DURATA_STORICO_MS = 600_000;
/** I problemi contati nello storico: da «Media» in su, la soglia della pagina del cliente. */
export const GRAVITA_MIN_CLIENTE = 3;
const cacheFamiglie = new Map<string, { dati: RispostaFamiglie; quando: number; firma: string }>();
const cacheStorico = new Map<string, { dati: RispostaStorico; quando: number; firma: string }>();

/** Svuota la cache di un cliente (configurazione cambiata) o di tutti (prove). */
export function svuotaCachePannello(tenant?: string): void {
  if (tenant === undefined) {
    cacheLetture.clear();
    cacheValori.clear();
    cacheFamiglie.clear();
    cacheStorico.clear();
    return;
  }
  cacheLetture.delete(tenant);
  cacheFamiglie.delete(tenant);
  cacheStorico.delete(tenant);
  for (const k of [...cacheValori.keys()]) if (k.startsWith(`${tenant}|`)) cacheValori.delete(k);
}

function firma(cfg: ConfigLettura): string {
  return [cfg.baseUrl, cfg.chiaveId, cfg.impronta ?? "", cfg.codcli, cfg.aggiornatoIl].join("|");
}

function lettore(d: DipendenzePannello, cfg: ConfigLettura, chiave: string): Lettore {
  return { base: new URL(normalizzaBase(cfg.baseUrl)), codcli: cfg.codcli, trasporto: d.trasporto(cfg, chiave) };
}

type Preparazione =
  | { tipo: "fermo"; pannello: PannelloZabbix }
  | { tipo: "pronto"; cfg: ConfigLettura; chiave: string; proxy: ProxyLocale };

function prepara(d: DipendenzePannello): Preparazione {
  if (!d.acquistato()) {
    return {
      tipo: "fermo",
      pannello: {
        stato: "non_acquistato",
        messaggio: "Il pannello Zabbix è un modulo opzionale non compreso in questa installazione.",
        proxyLocale: d.proxyLocale(null),
      },
    };
  }
  const cfg = leggiConfigLettura(d.db);
  if (!cfg) {
    return {
      tipo: "fermo",
      pannello: {
        stato: "da_configurare",
        messaggio: "Mancano indirizzo del centro e chiave di lettura: si configurano in Impostazioni → Moduli.",
        proxyLocale: d.proxyLocale(null),
      },
    };
  }
  const proxy = d.proxyLocale(cfg.proxyLocale);
  if (!cfg.enabled) {
    return {
      tipo: "fermo",
      pannello: { stato: "spento", messaggio: "Il pannello è spento: nessuna richiesta al centro.", proxyLocale: proxy },
    };
  }
  const chiave = chiaveLettura(d.db);
  if (!chiave) {
    return {
      tipo: "fermo",
      pannello: {
        stato: "guasto",
        messaggio: "La chiave di lettura salvata non si decifra: inseriscila di nuovo.",
        clienteErrato: false,
        ultimaLetturaOk: cfg.ultimaLetturaOk,
        prossimoTentativo: null,
        fallimenti: cfg.fallimenti,
        proxyLocale: proxy,
      },
    };
  }
  return { tipo: "pronto", cfg, chiave, proxy };
}

/** Il testo di un «cliente errato» (`client.ts`): riconosciuto anche quando si rilegge dal DB durante l'attesa. */
const CLIENTE_ERRATO = /^cliente errato/;

function guasto(cfg: ConfigLettura, proxy: ProxyLocale, messaggio: string, clienteErrato: boolean): PannelloZabbix {
  return {
    stato: "guasto",
    messaggio,
    clienteErrato,
    ultimaLetturaOk: cfg.ultimaLetturaOk,
    prossimoTentativo: cfg.prossimoTentativo,
    fallimenti: cfg.fallimenti,
    proxyLocale: proxy,
  };
}

/**
 * La lettura del centro: dalla cache se fresca, altrimenti dal centro se l'attesa è
 * finita (o `forza`). Restituisce la lettura o il pannello di guasto.
 */
async function lettura(
  d: DipendenzePannello,
  cfg: ConfigLettura,
  chiave: string,
  proxy: ProxyLocale,
  forza: boolean,
): Promise<{ ok: true; lettura: LetturaCentro } | { ok: false; pannello: PannelloZabbix }> {
  const ora = d.adesso();
  const f = firma(cfg);
  const c = cacheLetture.get(d.tenant);
  if (!forza && c && c.firma === f && ora.getTime() - c.quando < DURATA_CACHE_MS) {
    return { ok: true, lettura: c.lettura };
  }
  if (!forza && cfg.prossimoTentativo && new Date(cfg.prossimoTentativo).getTime() > ora.getTime()) {
    const testo = cfg.ultimoErrore ?? "Ultima lettura non riuscita";
    return { ok: false, pannello: guasto(cfg, proxy, testo, CLIENTE_ERRATO.test(testo)) };
  }
  try {
    // Due pagine aperte insieme a cache scaduta fanno una lettura sola.
    const chiaveVolo = `${d.tenant}|${f}`;
    let volo = inVolo.get(chiaveVolo);
    if (!volo) {
      volo = leggiCentro(lettore(d, cfg, chiave)).finally(() => inVolo.delete(chiaveVolo));
      inVolo.set(chiaveVolo, volo);
    }
    const l = await volo;
    registraSuccesso(d.db, ora);
    cacheLetture.set(d.tenant, { lettura: l, quando: ora.getTime(), firma: f });
    return { ok: true, lettura: l };
  } catch (e) {
    const err = e instanceof ErroreLettura ? e : new ErroreLettura("rete", "lettura del centro non riuscita");
    // Nessun dato di prima resta usabile: né per mostrarlo, né per confermare un abbinamento.
    svuotaCachePannello(d.tenant);
    const testo = err.message;
    const r = registraFallimento(d.db, ora, testo, (n) => attesaDopoFallimenti(n, err.dettagli.riprovaTraS));
    const dopo = leggiConfigLettura(d.db) ?? { ...cfg, fallimenti: r.fallimenti, prossimoTentativo: r.prossimo };
    return { ok: false, pannello: guasto(dopo, proxy, testo, err.tipo === "cliente_errato") };
  }
}

/** Il pannello va nel menu: opzione acquistata, configurata e accesa. Nessuna rete. */
export function pannelloNelMenu(d: Pick<DipendenzePannello, "db" | "acquistato">): boolean {
  if (!d.acquistato()) return false;
  return leggiConfigLettura(d.db)?.enabled === true;
}

/** Abbina tutti gli host del centro con DA-IPAM (una query per gli IP, una per i salvati). */
export function abbinaLettura(db: Database.Database, host: readonly HostDelCentro[]): RisultatoAbbinamento {
  return abbina(host, hostIpamPerIp(db, host.flatMap((h) => h.ip)), abbinamentiSalvati(db));
}

export interface RichiestaPannello {
  pagina?: number;
  per?: number;
  /** Solo gli host del proxy di questa macchina. */
  soloQuestaMacchina?: boolean;
  /** «Riprova adesso» di un admin: ignora attesa e cache. */
  forza?: boolean;
}

/** Il pannello per la pagina. */
export async function leggiPannello(d: DipendenzePannello, r: RichiestaPannello = {}): Promise<PannelloZabbix> {
  const p = prepara(d);
  if (p.tipo === "fermo") return p.pannello;
  const { cfg, chiave, proxy } = p;
  const esito = await lettura(d, cfg, chiave, proxy, r.forza === true);
  if (!esito.ok) return esito.pannello;
  const l = esito.lettura;

  const nomeLocale = proxy.nome;
  const proxyCentro: ProxyMostrato[] = l.cliente.proxy.map((x) => ({
    nome: x.nome,
    inLinea: x.in_linea,
    ultimoContatto: x.ultimo_contatto ?? null,
    diQuestaMacchina: nomeLocale !== null && x.nome === nomeLocale,
  }));
  const abbinamenti = abbinaLettura(d.db, l.host);
  const problemiPerHost = new Map<string, number>();
  for (const pr of l.problemi.problemi) problemiPerHost.set(pr.hostid, (problemiPerHost.get(pr.hostid) ?? 0) + 1);
  const nomePerHost = new Map(l.host.map((h) => [h.hostid, h.nome || h.host]));

  const filtrati = r.soloQuestaMacchina && nomeLocale ? l.host.filter((h) => h.proxy === nomeLocale) : l.host;
  const per = Math.min(PER_PAGINA, Math.max(1, Math.floor(r.per ?? PER_PAGINA)));
  const pagine = Math.max(1, Math.ceil(filtrati.length / per));
  const pagina = Math.min(pagine, Math.max(1, Math.floor(r.pagina ?? 1)));
  const fetta = filtrati.slice((pagina - 1) * per, pagina * per);

  // Valori solo per la pagina (al più 50 hostid, il massimo dell'API). Un errore qui non
  // butta il resto del pannello e non fa scattare l'attesa: il centro ha appena risposto.
  let erroreValori: string | null = null;
  const valoriPerHost = new Map<string, ValoreMostrato[]>();
  if (fetta.length) {
    const ids = fetta.map((h) => h.hostid);
    const chiaveCache = `${d.tenant}|${firma(cfg)}|${ids.join(",")}`;
    const ora = d.adesso().getTime();
    let v = cacheValori.get(chiaveCache);
    if (!v || ora - v.quando >= DURATA_CACHE_MS) {
      try {
        v = { valori: await leggiValori(lettore(d, cfg, chiave), ids), quando: ora };
        cacheValori.set(chiaveCache, v);
      } catch (e) {
        v = undefined;
        if (e instanceof ErroreLettura && e.tipo === "cliente_errato") {
          // Anche qui: un cliente errato non lascia a schermo niente.
          svuotaCachePannello(d.tenant);
          const r2 = registraFallimento(d.db, d.adesso(), e.message, (n) => attesaDopoFallimenti(n));
          return guasto({ ...cfg, fallimenti: r2.fallimenti, prossimoTentativo: r2.prossimo }, proxy, e.message, true);
        }
        erroreValori = e instanceof Error ? e.message : "valori non letti";
      }
    }
    for (const x of v?.valori.valori ?? []) {
      const l2 = valoriPerHost.get(x.hostid) ?? [];
      l2.push({
        chiave: x.chiave,
        valore: x.valore,
        unita: x.unita,
        clock: x.clock ?? null,
        // Un valore servito da una lettura vecchia è vecchio anche se l'item non lo era.
        vecchio: x.vecchio || v!.valori.vecchio,
      });
      valoriPerHost.set(x.hostid, l2);
    }
  }

  const host: HostMostrato[] = fetta.map((h) => ({
    hostid: h.hostid,
    nome: h.nome,
    host: h.host,
    ip: h.ip,
    proxy: h.proxy ?? null,
    diQuestaMacchina: nomeLocale !== null && h.proxy === nomeLocale,
    tipologia: h.tipologia ?? null,
    disponibilita: disponibilitaDaMostrare(h, l.vecchio),
    disponibilitaUltimaNota: h.disponibilita.complessiva,
    datiAffidabili: h.dati_affidabili && !l.vecchio,
    problemiAperti: problemiPerHost.get(h.hostid) ?? 0,
    abbinamento: abbinamenti.perHost.get(h.hostid) ?? ({ stato: "nessuno" } as EsitoAbbinamento),
    valori: valoriPerHost.get(h.hostid) ?? [],
  }));

  const problemiTotali = l.problemi.problemi.length + l.problemi.troncati;
  return {
    stato: "ok",
    cliente: l.cliente.cliente,
    codcli: l.cliente.codcli,
    lettoAlle: l.cliente.letto_alle ?? null,
    etaS: l.etaS,
    vecchio: l.vecchio,
    proxyCentro,
    riepilogo: riepiloga(l.host, proxyCentro, problemiTotali, { vecchio: l.vecchio, etaS: l.etaS }),
    problemi: l.problemi.problemi.slice(0, 500).map((pr) => ({ ...pr, nomeHost: nomePerHost.get(pr.hostid) ?? pr.hostid })),
    problemiTroncati: l.problemi.troncati + Math.max(0, l.problemi.problemi.length - 500),
    host,
    pagina,
    per,
    totale: filtrati.length,
    persi: abbinamenti.persi,
    erroreValori,
    proxyLocale: proxy,
  };
}

export type EsitoConferma = { ok: true } | { ok: false; status: 404 | 409; errore: string };

/**
 * Conferma di una persona: un abbinamento **proposto** diventa verificato. Si rifà il
 * calcolo sull'ultima lettura buona (al più 10 minuti fa): se nel frattempo non è più
 * proposto per quell'host (ambiguo, cambiato, già verificato) si rifiuta.
 */
export function confermaAbbinamento(
  d: DipendenzePannello,
  richiesta: { hostid: string; hostId: number },
  chi: string,
): EsitoConferma {
  const c = cacheLetture.get(d.tenant);
  if (!c || d.adesso().getTime() - c.quando > ETA_MASSIMA_CONFERMA_MS) {
    return { ok: false, status: 409, errore: "Nessuna lettura recente del centro: ricarica il pannello e riprova" };
  }
  const h = c.lettura.host.find((x) => x.hostid === richiesta.hostid);
  if (!h) return { ok: false, status: 404, errore: "Host del centro non trovato nell'ultima lettura" };
  const esito = abbinaLettura(d.db, c.lettura.host).perHost.get(h.hostid);
  if (!esito || esito.stato !== "proposto" || esito.hostId !== richiesta.hostId) {
    return { ok: false, status: 409, errore: "L'abbinamento non è più quello proposto: ricarica il pannello" };
  }
  salvaAbbinamento(d.db, { hostid: h.hostid, hostId: esito.hostId, ip: esito.ip }, chi);
  return { ok: true };
}

/** Ciò che serve alla pagina DATIA MONITORING della vista cliente (13/11/2026). */
export type LetturaMonitoring =
  | { stato: "fermo"; pannello: Exclude<PannelloZabbix, { stato: "ok" }> }
  | {
      stato: "ok";
      centro: LetturaCentro;
      famiglie: RispostaFamiglie;
      /** null: lo storico non si è letto; il resto della pagina resta in piedi. */
      storico: RispostaStorico | null;
    };

/**
 * La lettura per la pagina del cliente: gli stessi stati e la stessa attesa crescente
 * del pannello, più le famiglie (obbligatorie: senza, è un guasto detto) e lo storico
 * (facoltativo). Mai `forza`: il cliente non scavalca l'attesa.
 */
export async function leggiMonitoringCentro(d: DipendenzePannello): Promise<LetturaMonitoring> {
  const p = prepara(d);
  if (p.tipo === "fermo") return { stato: "fermo", pannello: p.pannello as Exclude<PannelloZabbix, { stato: "ok" }> };
  const { cfg, chiave, proxy } = p;
  const esito = await lettura(d, cfg, chiave, proxy, false);
  if (!esito.ok) return { stato: "fermo", pannello: esito.pannello as Exclude<PannelloZabbix, { stato: "ok" }> };
  const f = firma(cfg);
  const ora = d.adesso().getTime();
  const l = lettore(d, cfg, chiave);
  let fam = cacheFamiglie.get(d.tenant);
  if (!fam || fam.firma !== f || ora - fam.quando >= DURATA_FAMIGLIE_MS) {
    try {
      fam = { dati: await leggiFamiglie(l), quando: ora, firma: f };
      cacheFamiglie.set(d.tenant, fam);
    } catch (e) {
      const testo = e instanceof ErroreLettura ? e.message : "lettura delle famiglie non riuscita";
      // Il centro ha appena risposto alle altre rotte: niente attesa crescente, ma nessun dato di prima.
      cacheFamiglie.delete(d.tenant);
      return { stato: "fermo", pannello: guasto(cfg, proxy, testo, false) as Exclude<PannelloZabbix, { stato: "ok" }> };
    }
  }
  let sto = cacheStorico.get(d.tenant);
  if (!sto || sto.firma !== f || ora - sto.quando >= DURATA_STORICO_MS) {
    try {
      sto = { dati: await leggiStorico(l, GRAVITA_MIN_CLIENTE), quando: ora, firma: f };
      cacheStorico.set(d.tenant, sto);
    } catch {
      cacheStorico.delete(d.tenant);
      sto = undefined;
    }
  }
  return { stato: "ok", centro: esito.lettura, famiglie: fam.dati, storico: sto?.dati ?? null };
}
