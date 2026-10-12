/**
 * Misura del database di un tenant, in sola lettura (tappa 3, T3-01).
 *
 * Serve prima e dopo ogni intervento sul database (chiave dei MAC, storico
 * MAC-IP, retention): la stessa misura, ripetibile, sullo stesso file. Restituisce
 * solo numeri, nomi di tabella e di colonna, date, tipi di scansione e id di rete:
 * mai MAC, IP, nomi o altri valori del cliente, così l'output si può incollare in
 * un documento o in un messaggio.
 *
 * Il modulo è puro: riceve una connessione già aperta e rifiuta quelle scrivibili.
 * Non importa né l'hub né `db-tenant`, così si usa anche su una copia del file.
 */
import Database from "better-sqlite3";

type Db = Database.Database;

export interface OpzioniMisura {
  /** Salta `dbstat` (lento sui DB grandi): i byte per tabella restano `null`. */
  senzaSpazio?: boolean;
  /** Riferimento per «oltre N giorni», formato `YYYY-MM-DD HH:MM:SS` UTC. Di default ora. */
  adesso?: string;
}

export interface MisuraTabella {
  tabella: string;
  righe: number;
  /** Dati + indici, da `dbstat`; `null` se lo spazio non è stato misurato. */
  byte: number | null;
  byte_indici: number | null;
}

export interface FormeColonna {
  tabella: string;
  colonna: string;
  totale: number;
  nulli: number;
  /** Conteggio per forma (es. `due_punti_maiuscolo`, `cifre_12_minuscolo`, `spazio`, `t_z`). */
  forme: Record<string, number>;
}

export interface OltreGiorni {
  tabella: string;
  colonna: string;
  presente: boolean;
  totale: number;
  oltre_30: number;
  oltre_90: number;
  oltre_180: number;
  /** Righe con una data che SQLite non sa leggere: non entrano nei conteggi sopra. */
  non_leggibili: number;
}

export interface UltimaScansione {
  network_id: number | null;
  scan_type: string;
  righe: number;
  ultima: string | null;
  giorni: number | null;
}

export interface MisuraDbTenant {
  misurata_il: string;
  file: {
    page_size: number;
    page_count: number;
    freelist_count: number;
    byte: number;
    auto_vacuum: number;
    user_version: number;
    journal_mode: string;
  };
  spazio: { disponibile: boolean; motivo: string | null };
  tabelle: MisuraTabella[];
  mac_ip_history: {
    presente: boolean;
    righe: number;
    coppie_distinte: number;
    righe_ripetute: number;
    mac_con_piu_ip: number;
    /** Coppie note unendo storico, IP attuale e IP precedente di `mac_ip_mapping`; `null` se la mappa manca. */
    coppie_note_con_mappa: number | null;
    prima: string | null;
    ultima: string | null;
    righe_al_giorno: { giorno: string; righe: number }[];
  };
  /** MAC con più IP contemporanei nella tabella ARP; `null` se la tabella manca. */
  mac_con_piu_ip_arp: number | null;
  /** MAC presenti su più host e quanti host coinvolgono; `null` se `hosts.mac` manca. */
  mac_su_piu_host: { mac: number; host: number } | null;
  forme_mac: FormeColonna[];
  forme_date: FormeColonna[];
  oltre_giorni: OltreGiorni[];
  scan_history_ultime: UltimaScansione[];
}

/** Tabelle storiche e colonna della data: le stesse della retention (D4). */
export const TABELLE_STORICHE: ReadonlyArray<{ tabella: string; colonna: string }> = [
  { tabella: "status_history", colonna: "checked_at" },
  { tabella: "scan_history", colonna: "timestamp" },
  { tabella: "mac_ip_history", colonna: "changed_at" },
  { tabella: "host_classification_history", colonna: "at" },
];

/** Colonne di data di cui si contano le forme (spazio contro `T…Z`). */
const COLONNE_DATA: ReadonlyArray<{ tabella: string; colonna: string }> = [
  ...TABELLE_STORICHE,
  { tabella: "mac_ip_mapping", colonna: "first_seen" },
  { tabella: "mac_ip_mapping", colonna: "last_seen" },
  { tabella: "arp_entries", colonna: "timestamp" },
];

/**
 * Una colonna è «di MAC» per nome: `mac`, `mac_normalized`, `mac_display`,
 * `mac_address`, `*_mac`; non i flag come `is_virtual_mac`.
 */
const NOME_COLONNA_MAC = /^(mac|mac_normalized|mac_display|mac_address)$|^(?!is_|has_)\w+_mac$/;

/** Apre un file esistente in sola lettura: non lo crea e non lo modifica. */
export function apriInSolaLettura(percorso: string): Db {
  return new Database(percorso, { readonly: true, fileMustExist: true });
}

/** Nome SQL sicuro: i nomi vengono dallo schema, ma si quotano comunque. */
function q(nome: string): string {
  return `"${nome.replace(/"/g, '""')}"`;
}

function numero(v: unknown): number {
  return typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : 0;
}

function adessoUtc(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

const ESA = "[0-9A-Fa-f]";
const COPPIA = `${ESA}${ESA}`;
const GLOB_MAC = {
  due_punti: Array(6).fill(COPPIA).join(":"),
  trattini: Array(6).fill(COPPIA).join("-"),
  cifre_12: Array(6).fill(COPPIA).join(""),
  punti: Array(3).fill(`${COPPIA}${COPPIA}`).join("."),
};

/**
 * Forma di un MAC: separatore e maiuscole. Un MAC senza lettere minuscole conta
 * come maiuscolo (solo cifre compreso); con maiuscole e minuscole insieme è misto.
 */
function sqlFormaMac(col: string): string {
  const caso = `CASE WHEN ${col} GLOB '*[a-f]*' AND ${col} GLOB '*[A-F]*' THEN 'misto'
                     WHEN ${col} GLOB '*[a-f]*' THEN 'minuscolo' ELSE 'maiuscolo' END`;
  const rami = Object.entries(GLOB_MAC)
    .map(([forma, glob]) => `WHEN ${col} GLOB '${glob}' THEN '${forma}_' || ${caso}`)
    .join("\n");
  return `CASE WHEN ${col} = '' THEN 'vuoto' ${rami} ELSE 'altro' END`;
}

function sqlFormaData(col: string): string {
  return `CASE
    WHEN ${col} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:*' THEN 'spazio'
    WHEN ${col} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z' THEN 't_z'
    WHEN ${col} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*' THEN 't_senza_z'
    WHEN ${col} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN 'solo_data'
    ELSE 'altro' END`;
}

function contaForme(db: Db, tabella: string, colonna: string, espr: (c: string) => string): FormeColonna {
  const c = q(colonna);
  const righe = db
    .prepare(`SELECT ${espr(c)} AS forma, COUNT(*) AS n FROM ${q(tabella)} WHERE ${c} IS NOT NULL GROUP BY forma ORDER BY forma`)
    .all() as { forma: string; n: number }[];
  const totale = numero((db.prepare(`SELECT COUNT(*) AS n FROM ${q(tabella)}`).get() as { n: number }).n);
  const forme: Record<string, number> = {};
  let nonNulli = 0;
  for (const r of righe) {
    forme[r.forma] = numero(r.n);
    nonNulli += numero(r.n);
  }
  return { tabella, colonna, totale, nulli: totale - nonNulli, forme };
}

/**
 * Misura il database. Lancia un errore se la connessione è scrivibile: la misura
 * deve poter girare sulla copia di produzione senza toccarla.
 */
export function misuraDbTenant(db: Db, opzioni: OpzioniMisura = {}): MisuraDbTenant {
  if (!db.readonly) {
    throw new Error("misura del DB: serve una connessione in sola lettura (apriInSolaLettura)");
  }
  const adesso = opzioni.adesso ?? adessoUtc();
  const uno = <T>(sql: string, ...arg: unknown[]): T => db.prepare(sql).get(...arg) as T;
  const conta = (sql: string, ...arg: unknown[]): number => numero(uno<{ n: number }>(sql, ...arg).n);

  const nomiTabelle = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
  const tabelle = new Set(nomiTabelle);
  const colonne = new Map<string, Set<string>>();
  for (const t of nomiTabelle) {
    const info = db.prepare(`PRAGMA table_info(${q(t)})`).all() as { name: string }[];
    colonne.set(t, new Set(info.map((r) => r.name)));
  }
  const haColonna = (t: string, c: string): boolean => colonne.get(t)?.has(c) ?? false;

  const pragma = (nome: string): number => numero(db.pragma(nome, { simple: true }));
  const pageSize = pragma("page_size");
  const pageCount = pragma("page_count");
  const file = {
    page_size: pageSize,
    page_count: pageCount,
    freelist_count: pragma("freelist_count"),
    byte: pageSize * pageCount,
    auto_vacuum: pragma("auto_vacuum"),
    user_version: pragma("user_version"),
    journal_mode: String(db.pragma("journal_mode", { simple: true })),
  };

  // Spazio per tabella da dbstat (dati + indici, indici a parte).
  const spazio: MisuraDbTenant["spazio"] = { disponibile: false, motivo: null };
  const byteTabella = new Map<string, { byte: number; indici: number }>();
  if (opzioni.senzaSpazio) {
    spazio.motivo = "saltato (--senza-spazio)";
  } else {
    try {
      const righe = db
        .prepare(
          `SELECT m.tbl_name AS t, SUM(s.pgsize) AS b, SUM(CASE WHEN m.type = 'index' THEN s.pgsize ELSE 0 END) AS i
             FROM dbstat s JOIN sqlite_master m ON m.name = s.name GROUP BY m.tbl_name`,
        )
        .all() as { t: string; b: number; i: number }[];
      for (const r of righe) byteTabella.set(r.t, { byte: numero(r.b), indici: numero(r.i) });
      spazio.disponibile = true;
    } catch (e) {
      spazio.motivo = `dbstat non disponibile: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const misTabelle: MisuraTabella[] = nomiTabelle.map((t) => ({
    tabella: t,
    righe: conta(`SELECT COUNT(*) AS n FROM ${q(t)}`),
    byte: spazio.disponibile ? (byteTabella.get(t)?.byte ?? 0) : null,
    byte_indici: spazio.disponibile ? (byteTabella.get(t)?.indici ?? 0) : null,
  }));
  misTabelle.sort((a, b) => (b.byte ?? 0) - (a.byte ?? 0) || b.righe - a.righe || a.tabella.localeCompare(b.tabella));

  // Storico MAC-IP.
  const storico: MisuraDbTenant["mac_ip_history"] = {
    presente: tabelle.has("mac_ip_history"),
    righe: 0,
    coppie_distinte: 0,
    righe_ripetute: 0,
    mac_con_piu_ip: 0,
    coppie_note_con_mappa: null,
    prima: null,
    ultima: null,
    righe_al_giorno: [],
  };
  if (storico.presente) {
    storico.righe = conta("SELECT COUNT(*) AS n FROM mac_ip_history");
    storico.coppie_distinte = conta("SELECT COUNT(*) AS n FROM (SELECT 1 FROM mac_ip_history GROUP BY mac_normalized, ip)");
    storico.righe_ripetute = storico.righe - storico.coppie_distinte;
    storico.mac_con_piu_ip = conta(
      "SELECT COUNT(*) AS n FROM (SELECT 1 FROM mac_ip_history GROUP BY mac_normalized HAVING COUNT(DISTINCT ip) > 1)",
    );
    const estremi = uno<{ prima: string | null; ultima: string | null }>(
      "SELECT MIN(changed_at) AS prima, MAX(changed_at) AS ultima FROM mac_ip_history",
    );
    storico.prima = estremi.prima;
    storico.ultima = estremi.ultima;
    storico.righe_al_giorno = (
      db
        .prepare(
          "SELECT COALESCE(date(changed_at), 'non leggibile') AS giorno, COUNT(*) AS righe FROM mac_ip_history GROUP BY giorno ORDER BY giorno",
        )
        .all() as { giorno: string; righe: number }[]
    ).map((r) => ({ giorno: r.giorno, righe: numero(r.righe) }));
    if (tabelle.has("mac_ip_mapping")) {
      const precedente = haColonna("mac_ip_mapping", "previous_ip")
        ? " UNION SELECT mac_normalized, previous_ip FROM mac_ip_mapping WHERE previous_ip IS NOT NULL AND previous_ip <> ''"
        : "";
      storico.coppie_note_con_mappa = conta(
        `SELECT COUNT(*) AS n FROM (SELECT mac_normalized, ip FROM mac_ip_history
           UNION SELECT mac_normalized, ip FROM mac_ip_mapping${precedente})`,
      );
    }
  }

  const macConPiuIpArp =
    haColonna("arp_entries", "mac") && haColonna("arp_entries", "ip")
      ? conta(
          "SELECT COUNT(*) AS n FROM (SELECT 1 FROM arp_entries WHERE ip IS NOT NULL GROUP BY UPPER(mac) HAVING COUNT(DISTINCT ip) > 1)",
        )
      : null;

  let macSuPiuHost: MisuraDbTenant["mac_su_piu_host"] = null;
  if (haColonna("hosts", "mac")) {
    const r = uno<{ mac: number; host: number | null }>(
      `SELECT COUNT(*) AS mac, SUM(n) AS host FROM
         (SELECT COUNT(*) AS n FROM hosts WHERE mac IS NOT NULL AND mac <> '' GROUP BY UPPER(mac) HAVING COUNT(*) > 1)`,
    );
    macSuPiuHost = { mac: numero(r.mac), host: numero(r.host) };
  }

  const formeMac: FormeColonna[] = [];
  for (const t of nomiTabelle) {
    for (const c of colonne.get(t) ?? []) {
      if (NOME_COLONNA_MAC.test(c)) formeMac.push(contaForme(db, t, c, sqlFormaMac));
    }
  }
  const formeDate = COLONNE_DATA.filter(({ tabella, colonna }) => haColonna(tabella, colonna)).map(({ tabella, colonna }) =>
    contaForme(db, tabella, colonna, sqlFormaData),
  );

  const oltreGiorni: OltreGiorni[] = TABELLE_STORICHE.map(({ tabella, colonna }) => {
    const vuota: OltreGiorni = {
      tabella, colonna, presente: false, totale: 0, oltre_30: 0, oltre_90: 0, oltre_180: 0, non_leggibili: 0,
    };
    if (!haColonna(tabella, colonna)) return vuota;
    const c = q(colonna);
    const r = uno<Record<string, number | null>>(
      `SELECT COUNT(*) AS totale,
              SUM(CASE WHEN julianday(${c}) < julianday(@adesso) - 30 THEN 1 ELSE 0 END) AS oltre_30,
              SUM(CASE WHEN julianday(${c}) < julianday(@adesso) - 90 THEN 1 ELSE 0 END) AS oltre_90,
              SUM(CASE WHEN julianday(${c}) < julianday(@adesso) - 180 THEN 1 ELSE 0 END) AS oltre_180,
              SUM(CASE WHEN julianday(${c}) IS NULL THEN 1 ELSE 0 END) AS non_leggibili
         FROM ${q(tabella)}`,
      { adesso },
    );
    return {
      ...vuota,
      presente: true,
      totale: numero(r.totale),
      oltre_30: numero(r.oltre_30),
      oltre_90: numero(r.oltre_90),
      oltre_180: numero(r.oltre_180),
      non_leggibili: numero(r.non_leggibili),
    };
  });

  const scanUltime: UltimaScansione[] =
    haColonna("scan_history", "network_id") && haColonna("scan_history", "timestamp")
      ? (
          db
            .prepare(
              `SELECT network_id, scan_type, COUNT(*) AS righe, MAX(timestamp) AS ultima,
                      CAST(julianday(@adesso) - julianday(MAX(timestamp)) AS INTEGER) AS giorni
                 FROM scan_history GROUP BY network_id, scan_type ORDER BY network_id, scan_type`,
            )
            .all({ adesso }) as UltimaScansione[]
        ).map((r) => ({ ...r, righe: numero(r.righe) }))
      : [];

  return {
    misurata_il: adesso,
    file,
    spazio,
    tabelle: misTabelle,
    mac_ip_history: storico,
    mac_con_piu_ip_arp: macConPiuIpArp,
    mac_su_piu_host: macSuPiuHost,
    forme_mac: formeMac,
    forme_date: formeDate,
    oltre_giorni: oltreGiorni,
    scan_history_ultime: scanUltime,
  };
}

const n = (v: number | null): string => (v === null ? "—" : v.toLocaleString("it-IT"));
const mb = (v: number | null): string => (v === null ? "—" : `${(v / 1_048_576).toFixed(1).replace(".", ",")} MB`);
const forme = (f: Record<string, number>): string =>
  Object.entries(f)
    .map(([k, v]) => `${k} ${n(v)}`)
    .join(" · ") || "nessun valore";

/** Resa testuale della misura, da leggere a terminale. Solo numeri e nomi. */
export function tabellaLeggibile(m: MisuraDbTenant, giorniRecenti = 14): string {
  const r: string[] = [];
  r.push(`Misura del DB tenant — ${m.misurata_il} UTC`);
  r.push(
    `File: ${mb(m.file.byte)} (${n(m.file.page_count)} pagine da ${n(m.file.page_size)}, libere ${n(m.file.freelist_count)}) · auto_vacuum=${m.file.auto_vacuum} · user_version=${m.file.user_version} · journal=${m.file.journal_mode}`,
  );
  r.push("");
  r.push(`Tabelle${m.spazio.disponibile ? "" : ` (spazio: ${m.spazio.motivo})`}`);
  for (const t of m.tabelle) {
    if (t.righe === 0 && !t.byte) continue;
    r.push(`  ${t.tabella.padEnd(36)} ${n(t.righe).padStart(12)} righe  ${mb(t.byte).padStart(10)}  (indici ${mb(t.byte_indici)})`);
  }
  r.push("");
  const h = m.mac_ip_history;
  if (!h.presente) {
    r.push("mac_ip_history: assente");
  } else {
    r.push(
      `mac_ip_history: ${n(h.righe)} righe dal ${h.prima ?? "—"} · ${n(h.coppie_distinte)} coppie MAC-IP · ${n(h.righe_ripetute)} righe che ripetono una coppia già vista · ${n(h.mac_con_piu_ip)} MAC con più IP`,
    );
    r.push(`  coppie note unendo storico e mac_ip_mapping (IP attuale e precedente): ${n(h.coppie_note_con_mappa)}`);
    r.push(`  righe al giorno (ultimi ${giorniRecenti} giorni con righe):`);
    for (const g of h.righe_al_giorno.slice(-giorniRecenti)) r.push(`    ${g.giorno}  ${n(g.righe)}`);
  }
  r.push(`MAC con più IP nella tabella ARP: ${n(m.mac_con_piu_ip_arp)}`);
  r.push(
    `MAC su più host: ${m.mac_su_piu_host ? `${n(m.mac_su_piu_host.mac)} (${n(m.mac_su_piu_host.host)} host)` : "—"}`,
  );
  r.push("");
  r.push("Forme dei MAC per colonna");
  for (const f of m.forme_mac) {
    r.push(`  ${`${f.tabella}.${f.colonna}`.padEnd(44)} ${forme(f.forme)}${f.nulli ? ` · NULL ${n(f.nulli)}` : ""}`);
  }
  r.push("Forme delle date");
  for (const f of m.forme_date) {
    r.push(`  ${`${f.tabella}.${f.colonna}`.padEnd(44)} ${forme(f.forme)}${f.nulli ? ` · NULL ${n(f.nulli)}` : ""}`);
  }
  r.push("");
  r.push("Righe oltre 30 / 90 / 180 giorni");
  for (const o of m.oltre_giorni) {
    if (!o.presente) {
      r.push(`  ${o.tabella}: assente`);
      continue;
    }
    r.push(
      `  ${o.tabella.padEnd(30)} ${n(o.totale).padStart(10)} righe · ${n(o.oltre_30)} / ${n(o.oltre_90)} / ${n(o.oltre_180)}${o.non_leggibili ? ` · date non leggibili ${n(o.non_leggibili)}` : ""}`,
    );
  }
  r.push("");
  r.push("Ultima scansione per (rete, tipo)");
  if (m.scan_history_ultime.length === 0) r.push("  scan_history: assente o vuota");
  for (const s of m.scan_history_ultime) {
    r.push(
      `  rete ${String(s.network_id ?? "—").padStart(4)}  ${s.scan_type.padEnd(22)} ${n(s.righe).padStart(8)} righe · ultima ${s.ultima ?? "—"} (${s.giorni ?? "—"} giorni fa)`,
    );
  }
  return r.join("\n");
}
