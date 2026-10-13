// Sequenza dei giri sovrapposti (T3-22, verifica di INV-1 e INV-2 sul dato vero).
//
// Fa girare il vero `discoverNetwork` (tipo «ping», l'unico con tutte le uscite
// coperte dal banco di T3-16) su una rete di un tenant già aperto, con la
// guardia di rete attiva e l'esecutore finto:
//
//   1. giro A trattenuto (un giro lento): risponde solo una parte degli host online;
//   2. mentre A è fermo si prova a far partire B sulla stessa rete, con tutti vivi;
//   3. sempre durante A, una parte degli host che A non vedrà viene vista viva da
//      un'altra fonte (come farebbero B o il controllo degli host noti);
//   4. A riparte e finisce;
//   5. un giro C in cui non risponde nessuno.
//
// Si misura: B rifiutato o no, quanti host visti dopo l'avvio di A finiscono
// offline, quante righe ogni giro tocca, quanti host il giro a zero vivi spegne.
// Il rapporto contiene SOLO conteggi: nessun indirizzo, nome o identificativo
// della rete, perché la sequenza gira anche su una copia del DB di un cliente.
//
// Il modulo non importa nulla che esista solo dopo la parte 3b (lucchetto,
// soglia): la stessa sequenza deve poter girare sulla base di confronto, dove il
// difetto si vede. Per questo il rifiuto di B si riconosce dal nome dell'errore
// e le impostazioni della soglia si scrivono in SQL.
//
// La guardia di rete va caricata prima dei moduli dello scanner: è il primo import.
import { tentativiBloccati } from "./guardia-rete";
import type { ScanIoOverride } from "@/lib/executor";
import type { Executor } from "@/lib/executor";
import { getTenantDb, withTenant } from "@/lib/db-tenant";
import { discoverNetwork, getScanProgress } from "@/lib/scanner/discovery";
import { creaEsecutoreFinto, installaEsecutoreFinto, togliEsecutoreFinto } from "./esecutore-finto";

type Db = ReturnType<typeof getTenantDb>;

/** Quota degli host online che rispondono al giro A: un calo sotto la soglia del 50%. */
const QUOTA_VIVI_A = 0.8;
/** Reti fino a 1024 indirizzi: il giro finto resta veloce anche sulle reti grandi del tenant. */
const PREFISSO_MINIMO = 22;
/** Host online minimi perché la rete serva alla prova (soglia: almeno 5 candidati). */
const ONLINE_MINIMI = 10;
const ATTESA_MASSIMA_MS = 180_000;

interface Riga {
  id: number;
  ip: string;
  status: string | null;
  last_seen: string | null;
  updated_at: string | null;
}

export interface ContiStato {
  host: number;
  online: number;
  offline: number;
  altri: number;
}

export interface MisuraGiro {
  esito: string;
  /** Host passati da non-offline a offline in questo giro. */
  passatiOffline: number;
  /** Scritture della colonna `status` (anche a valore invariato), contate da un trigger. */
  scrittureStato: number;
  /** Di queste, quante su host già offline riscritti offline (T3-20). */
  offlineRiscritti: number;
  /** Righe con `updated_at` cambiato in questo giro, per qualunque motivo. */
  righeToccate: number;
}

export interface RapportoGiriSovrapposti {
  rete: { prefisso: number; ipScansionati: number } & ContiStato;
  giroA: MisuraGiro & {
    viviNelGiro: number;
    nonVistiDaA: number;
    /** Host con `last_seen` successivo all'avvio di A, scritto da altri prima che A finisse. */
    vistiDopoAvvio: number;
    /** Di questi, quanti A ha mandato offline (il difetto di INV-1/INV-2). */
    spentiVistiDopo: number;
  };
  giroB: { rifiutato: boolean; esito: string | null };
  giroZero: MisuraGiro & { onlinePrima: number };
  finale: ContiStato;
  tentativiRete: number;
  verdetto: { ok: boolean; motivi: string[] };
}

function righe(db: Db, reteId: number): Map<number, Riga> {
  const tutte = db
    .prepare("SELECT id, ip, status, last_seen, updated_at FROM hosts WHERE network_id = ?")
    .all(reteId) as Riga[];
  return new Map(tutte.map((r) => [r.id, r]));
}

function conti(m: Map<number, Riga>): ContiStato {
  let online = 0;
  let offline = 0;
  for (const r of m.values()) {
    if (r.status === "online") online++;
    else if (r.status === "offline") offline++;
  }
  return { host: m.size, online, offline, altri: m.size - online - offline };
}

function confronta(prima: Map<number, Riga>, dopo: Map<number, Riga>): { passatiOffline: number; righeToccate: number } {
  let passatiOffline = 0;
  let righeToccate = 0;
  for (const [id, p] of prima) {
    const d = dopo.get(id);
    if (!d) continue;
    if (p.status !== "offline" && d.status === "offline") passatiOffline++;
    if (p.updated_at !== d.updated_at) righeToccate++;
  }
  return { passatiOffline, righeToccate };
}

/*
 * Contatore delle scritture di `status`. `updated_at` da solo non basta: a ogni
 * giro `syncIpAssignmentsForNetwork` lo riscrive su tutti gli host della rete,
 * quindi non dice chi ha scritto lo stato. Il trigger è TEMP: vive solo nella
 * connessione della prova (la stessa che usa la scansione), non nel file.
 */
function installaContatoreStato(db: Db): void {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS prova_scritture_stato (host_id INTEGER, prima TEXT, dopo TEXT);
    CREATE TEMP TRIGGER IF NOT EXISTS prova_conta_stato AFTER UPDATE OF status ON main.hosts
    BEGIN
      INSERT INTO prova_scritture_stato (host_id, prima, dopo) VALUES (OLD.id, OLD.status, NEW.status);
    END;
  `);
}

function azzeraContatoreStato(db: Db): void {
  db.exec("DELETE FROM temp.prova_scritture_stato");
}

function leggiContatoreStato(db: Db, ids: Map<number, Riga>): { scrittureStato: number; offlineRiscritti: number } {
  const scritture = db.prepare("SELECT host_id, prima, dopo FROM temp.prova_scritture_stato").all() as Array<{
    host_id: number;
    prima: string | null;
    dopo: string | null;
  }>;
  const dellaRete = scritture.filter((s) => ids.has(s.host_id));
  return {
    scrittureStato: dellaRete.length,
    offlineRiscritti: dellaRete.filter((s) => s.prima === "offline" && s.dopo === "offline").length,
  };
}

function togliContatoreStato(db: Db): void {
  db.exec("DROP TRIGGER IF EXISTS temp.prova_conta_stato; DROP TABLE IF EXISTS temp.prova_scritture_stato;");
}

function oraDb(db: Db): string {
  return (db.prepare("SELECT datetime('now') AS t").get() as { t: string }).t;
}

function attendi(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function attendiFine(scanId: string): Promise<string> {
  const limite = Date.now() + ATTESA_MASSIMA_MS;
  for (;;) {
    const p = getScanProgress(scanId);
    if (p && p.status !== "running") return p.status;
    if (Date.now() > limite) return "ancora in corso";
    await attendi(25);
  }
}

async function attendiCondizione(cond: () => boolean, cosa: string): Promise<void> {
  const limite = Date.now() + ATTESA_MASSIMA_MS;
  while (!cond()) {
    if (Date.now() > limite) throw new Error(`prova dei giri: ${cosa} non arrivato in tempo`);
    await attendi(10);
  }
}

/** Errore di rete occupata del lucchetto di T3-18, riconosciuto senza importarne il modulo. */
function eRifiutoReteOccupata(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "ScanInCorsoError";
}

function prefissoDi(cidr: string): number | null {
  const m = /\/(\d{1,2})$/.exec(cidr.trim());
  return m ? Number(m[1]) : null;
}

/**
 * La rete della prova: la più popolata di host online fra quelle fino a 1024
 * indirizzi, con almeno 10 host online. Null se il tenant non ne ha.
 */
export function scegliRete(db: Db): { id: number; cidr: string } | null {
  const reti = db
    .prepare(
      `SELECT n.id AS id, n.cidr AS cidr, SUM(CASE WHEN h.status = 'online' THEN 1 ELSE 0 END) AS online
         FROM networks n LEFT JOIN hosts h ON h.network_id = n.id
        GROUP BY n.id ORDER BY online DESC, n.id`,
    )
    .all() as Array<{ id: number; cidr: string; online: number | null }>;
  for (const r of reti) {
    const p = prefissoDi(r.cidr);
    if (p !== null && p >= PREFISSO_MINIMO && p <= 30 && (r.online ?? 0) >= ONLINE_MINIMI) {
      return { id: r.id, cidr: r.cidr };
    }
  }
  return null;
}

function scriviImpostazione(db: Db, chiave: string, valore: string): void {
  db.prepare(
    `INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(chiave, valore);
}

/**
 * Smistatore dell'esecutore finto: ogni giro prende lo scenario assegnato prima
 * della sua partenza, al suo `pingSweep`. Un `pingSweep` senza scenario
 * assegnato fallisce (e il giro con lui): un giro inatteso si vede.
 */
function creaSmistatore(): {
  override: ScanIoOverride;
  assegna(s: ScanIoOverride | null): void;
  sweepIniziati(): number;
} {
  const neutro = creaEsecutoreFinto({ vivi: [] }).override;
  let prossimo: ScanIoOverride | null = null;
  let corrente: ScanIoOverride = neutro;
  let iniziati = 0;
  const executor: Executor = {
    mode: "local",
    healthCheck: () => corrente.executor.healthCheck(),
    pingHost: (ip, t) => corrente.executor.pingHost(ip, t),
    pingSweep: (ips, conc, cb) => {
      const s = prossimo;
      prossimo = null;
      if (!s) return Promise.reject(new Error("prova dei giri: pingSweep senza scenario assegnato"));
      corrente = s;
      iniziati++;
      return s.executor.pingSweep(ips, conc, cb);
    },
    nmapDiscoverHosts: (t, ms) => corrente.executor.nmapDiscoverHosts(t, ms),
    nmapPortScan: (...a) => corrente.executor.nmapPortScan(...a),
    reverseDns: (...a) => neutro.executor.reverseDns(...a),
    forwardDns: (...a) => neutro.executor.forwardDns(...a),
    resolveDnsBatch: (...a) => neutro.executor.resolveDnsBatch(...a),
    macVendorLookup: (...a) => neutro.executor.macVendorLookup(...a),
  };
  const override: ScanIoOverride = {
    executor,
    tcpConnect: neutro.tcpConnect,
    readArpCache: neutro.readArpCache,
    runArpPoll: neutro.runArpPoll,
  };
  return {
    override,
    assegna: (s) => {
      prossimo = s;
    },
    sweepIniziati: () => iniziati,
  };
}

/**
 * Esegue la sequenza sul tenant `tenant` (DB già aperto e registrato nell'hub).
 * Scrive nel DB del tenant: va chiamata SOLO su una copia.
 */
export async function eseguiGiriSovrapposti(tenant: string): Promise<RapportoGiriSovrapposti> {
  const db = getTenantDb(tenant);
  const rete = scegliRete(db);
  if (!rete) throw new Error("prova dei giri: nessuna rete adatta (fino a /22 con almeno 10 host online)");
  const prefisso = prefissoDi(rete.cidr) ?? 0;
  const ipScansionati = Math.max(0, 2 ** (32 - prefisso) - 2);

  // Soglia in modo «applica», con i valori predefiniti; nessun candidato in
  // sospeso ereditato (la sequenza parte pulita). Sulla base di confronto queste
  // chiavi non le legge nessuno.
  scriviImpostazione(db, "offline_guard_mode", "applica");
  scriviImpostazione(db, "offline_guard_pct", "50");
  scriviImpostazione(db, "offline_guard_min", "5");
  db.prepare("DELETE FROM tenant_settings WHERE key = ?").run(`offline_guard_pending:${rete.id}`);

  const s0 = righe(db, rete.id);
  const onlinePrima = [...s0.values()].filter((r) => r.status === "online").sort((a, b) => a.id - b.id);
  const quantiViviA = Math.floor(onlinePrima.length * QUOTA_VIVI_A);
  const viviA = onlinePrima.slice(0, quantiViviA).map((r) => r.ip);
  const nonVistiDaA = onlinePrima.slice(quantiViviA);
  const vistiDaAltri = nonVistiDaA.slice(0, Math.ceil(nonVistiDaA.length / 2));

  const smistatore = creaSmistatore();
  installaEsecutoreFinto(smistatore.override);
  installaContatoreStato(db);
  tentativiBloccati.length = 0;
  try {
    // ── 1. Giro A, trattenuto dal cancello ──────────────────────────────────
    let apriA!: () => void;
    const cancelloA = new Promise<void>((r) => {
      apriA = r;
    });
    const scenarioA = creaEsecutoreFinto({ vivi: viviA, cancello: cancelloA }).override;
    const inizioA = oraDb(db);
    smistatore.assegna(scenarioA);
    const giroA = await withTenant(tenant, () => discoverNetwork(rete.id, "ping"));
    await attendiCondizione(() => smistatore.sweepIniziati() >= 1, "il ping del giro A");
    // `datetime('now')` ha il secondo come unità: ciò che segue avviene dopo l'avvio di A.
    await attendi(1_100);

    // ── 2. Giro B sulla stessa rete, tutti vivi ─────────────────────────────
    const scenarioB = creaEsecutoreFinto({ vivi: onlinePrima.map((r) => r.ip) }).override;
    smistatore.assegna(scenarioB);
    let rifiutato = false;
    let esitoB: string | null = null;
    try {
      const giroB = await withTenant(tenant, () => discoverNetwork(rete.id, "ping"));
      esitoB = await attendiFine(giroB.id);
    } catch (e) {
      if (!eRifiutoReteOccupata(e)) throw e;
      rifiutato = true;
    }
    smistatore.assegna(null);

    // ── 3. Un'altra fonte vede vivi alcuni host che A non vedrà ─────────────
    const segna = db.prepare("UPDATE hosts SET status = 'online', last_seen = datetime('now') WHERE id = ?");
    db.transaction(() => {
      for (const r of vistiDaAltri) segna.run(r.id);
    })();

    // ── 4. A riparte e finisce ──────────────────────────────────────────────
    const sMezzo = righe(db, rete.id);
    const vistiDopo = [...sMezzo.values()].filter((r) => r.last_seen !== null && r.last_seen >= inizioA);
    await attendi(1_100); // come sopra: le scritture di A cadono in un secondo nuovo
    azzeraContatoreStato(db);
    apriA();
    const esitoA = await attendiFine(giroA.id);
    const s1 = righe(db, rete.id);
    const statoA = leggiContatoreStato(db, s1);
    const spentiVistiDopo = vistiDopo.filter((r) => s1.get(r.id)?.status === "offline").length;

    // ── 5. Giro a zero vivi ─────────────────────────────────────────────────
    const onlinePrimaZero = conti(s1).online;
    await attendi(1_100); // updated_at a secondi: il confronto vede ogni riscrittura
    azzeraContatoreStato(db);
    smistatore.assegna(creaEsecutoreFinto({ vivi: [] }).override);
    const giroZero = await withTenant(tenant, () => discoverNetwork(rete.id, "ping"));
    const esitoZero = await attendiFine(giroZero.id);
    const s2 = righe(db, rete.id);
    const statoZero = leggiContatoreStato(db, s2);

    const misuraA: MisuraGiro = { esito: esitoA, ...confronta(sMezzo, s1), ...statoA };
    const misuraZero: MisuraGiro = { esito: esitoZero, ...confronta(s1, s2), ...statoZero };

    const motivi: string[] = [];
    if (!rifiutato) motivi.push("il giro B sulla stessa rete è partito mentre A era in corso");
    if (spentiVistiDopo > 0) motivi.push(`${spentiVistiDopo} host visti dopo l'avvio di A sono stati spenti da A`);
    if (misuraZero.passatiOffline > 0) motivi.push(`il giro a zero vivi ha spento ${misuraZero.passatiOffline} host`);
    if (misuraZero.scrittureStato > 0) motivi.push(`il giro a zero vivi ha scritto lo stato di ${misuraZero.scrittureStato} host`);
    if (misuraA.offlineRiscritti > 0 || misuraZero.offlineRiscritti > 0) {
      motivi.push(
        `host già offline riscritti offline: ${misuraA.offlineRiscritti} dal giro A, ${misuraZero.offlineRiscritti} dal giro a zero vivi`,
      );
    }
    if (esitoA !== "completed") motivi.push(`il giro A è finito «${esitoA}»`);
    if (esitoZero !== "completed") motivi.push(`il giro a zero vivi è finito «${esitoZero}»`);
    if (tentativiBloccati.length > 0) motivi.push(`${tentativiBloccati.length} tentativi di uscire sulla rete`);

    return {
      rete: { prefisso, ipScansionati, ...conti(s0) },
      giroA: {
        ...misuraA,
        viviNelGiro: viviA.length,
        nonVistiDaA: nonVistiDaA.length,
        vistiDopoAvvio: vistiDopo.length,
        spentiVistiDopo,
      },
      giroB: { rifiutato, esito: esitoB },
      giroZero: { ...misuraZero, onlinePrima: onlinePrimaZero },
      finale: conti(s2),
      tentativiRete: tentativiBloccati.length,
      verdetto: { ok: motivi.length === 0, motivi },
    };
  } finally {
    togliEsecutoreFinto();
    togliContatoreStato(db);
  }
}

/** Il rapporto in righe di testo, solo conteggi. */
export function righeRapporto(r: RapportoGiriSovrapposti): string[] {
  const st = (c: ContiStato) => `${c.host} host: ${c.online} online, ${c.offline} offline, ${c.altri} altro stato`;
  return [
    `Rete scelta: /${r.rete.prefisso} (${r.rete.ipScansionati} indirizzi), ${st(r.rete)}`,
    `Giro A: ${r.giroA.viviNelGiro} vivi, ${r.giroA.nonVistiDaA} online non visti; esito ${r.giroA.esito}`,
    `Giro B (stessa rete, durante A): ${r.giroB.rifiutato ? "RIFIUTATO" : `partito, esito ${r.giroB.esito}`}`,
    `Host visti dopo l'avvio di A: ${r.giroA.vistiDopoAvvio}; spenti da A: ${r.giroA.spentiVistiDopo}`,
    `Giro A: ${r.giroA.passatiOffline} passati offline, ${r.giroA.scrittureStato} scritture di stato (${r.giroA.offlineRiscritti} su host già offline), ${r.giroA.righeToccate} righe con updated_at cambiato`,
    `Giro a zero vivi (su ${r.giroZero.onlinePrima} online): esito ${r.giroZero.esito}, ${r.giroZero.passatiOffline} passati offline, ${r.giroZero.scrittureStato} scritture di stato (${r.giroZero.offlineRiscritti} su host già offline), ${r.giroZero.righeToccate} righe con updated_at cambiato`,
    `Alla fine: ${st(r.finale)}`,
    `Tentativi di uscire sulla rete: ${r.tentativiRete}`,
    r.verdetto.ok ? "ESITO: nessun accavallamento, nessun host vivo spento" : "ESITO: DIFETTO",
    ...r.verdetto.motivi.map((m) => `  - ${m}`),
  ];
}
