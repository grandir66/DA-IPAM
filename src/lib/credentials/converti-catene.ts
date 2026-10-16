/**
 * Tappa 2d credenziali (T16): le catene vecchie e i pin nella lista unica.
 *
 * Prima della 2d una rete aveva due liste: quella nuova (`network_credentials`)
 * e le catene per ruolo (`network_host_credentials`: windows, ssh, linux,
 * snmp), che scrive solo la pagina della rete, rimandandole senza mostrarle.
 * Il pin di un host (`host_detect_credential`) faceva da corto circuito nella
 * discovery, e le due chiavi «di default» dell'hub si accodavano in ogni
 * tenant. Qui, in una transazione:
 * - per ogni rete si accodano alla lista, dopo `MAX(sort_order)`, le righe
 *   vecchie che mancano, nei ruoli windows, ssh, linux, snmp (dentro il ruolo
 *   per `sort_order`, poi id). La posizione già presente vince. Si deduplica
 *   per voce su tutti i ruoli, tenendo la prima posizione: la stessa voce può
 *   stare in più ruoli (UNIQUE con `role`), la lista no (UNIQUE(network_id,
 *   credential_id)), e un doppio farebbe fallire la conversione del tenant;
 * - il tipo deve valere per il ruolo (`tipiPerRuoloVecchio`, la regola con cui
 *   il motore le legge), altrimenti la riga si salta e si elenca;
 * - le chiavi dell'hub (D3 = (a)) si accodano, dopo le vecchie, solo con un
 *   tenant attivo: sono id del DB di un tenant salvati nell'hub, e con due
 *   tenant lo stesso numero indica voci diverse. Altrimenti si saltano col
 *   motivo `MOTIVO_DUE_TENANT`, che non rende la conversione parziale;
 * - il pin diventa una riga validata dell'host (protocollo dal ruolo, porta
 *   della voce o standard, `validated_at` = quando il pin è stato scritto),
 *   se l'host non ha già la stessa voce sullo stesso protocollo, su qualunque
 *   porta.
 *
 * Così il motore dà, rete per rete, la stessa sequenza di voci per ssh, winrm
 * e snmp prima e dopo: le voci che prendeva dalle catene vecchie e dalla
 * chiave dell'hub le trova nella lista, nello stesso ordine.
 *
 * Le tabelle vecchie non si svuotano: restano congelate fino alla pulizia
 * della 2g. Per questo, col segno `done:` o `parziale:`, la conversione non si
 * richiama: una voce tolta dalla lista tornerebbe dalla catena congelata.
 *
 * Dalla 2g (T26) nessuno legge più le tabelle vecchie, e un DB che non le ha
 * (la pulizia della 2g le toglie; un tenant nato dopo) non ha niente da
 * convertire: esito vuoto, segno `done:`. Un bundle di prima della 2d le porta
 * ancora: l'import le mette in tabelle temporanee con gli stessi nomi
 * (`conCateneDelBundle`) e chiama questa conversione, con le stesse regole.
 *
 * Modulo puro: riceve l'handle, non importa né `db.ts` né `db-tenant.ts`.
 */
import type Database from "better-sqlite3";
import { portaCredenziale, type CredProtocol } from "./porte";
import { tipiPerRuoloVecchio } from "./tipi";

/** Le due tabelle delle catene vecchie: nessuno le legge dalla 2g, le toglie la pulizia (T27). */
export const TABELLE_CATENE_VECCHIE = ["network_host_credentials", "host_detect_credential"] as const;
export type TabellaCateneVecchie = (typeof TABELLE_CATENE_VECCHIE)[number];

/**
 * Chiavi «di default» dell'hub (`host_windows_credential_id`,
 * `host_linux_credential_id`) lette con il `getSetting` di chi chiama; id non
 * validi → null. Le legge solo questa conversione (D3 = (a)): dal T26 il
 * motore non le accoda più.
 */
export function chiaviGlobaliHub(leggi: (chiave: string) => string | null): { windows: number | null; linux: number | null } {
  const id = (chiave: string): number | null => {
    const s = leggi(chiave)?.trim();
    if (!s) return null;
    const n = parseInt(s, 10);
    return Number.isNaN(n) || n <= 0 ? null : n;
  };
  return { windows: id("host_windows_credential_id"), linux: id("host_linux_credential_id") };
}

/** La tabella c'è, nel DB o fra le temporanee della connessione (l'import di un bundle vecchio). */
function tabellaVisibile(db: Database.Database, nome: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
       UNION ALL SELECT 1 FROM sqlite_temp_master WHERE type = 'table' AND name = ?`
    )
    .get(nome, nome);
}

export interface GlobaliHub {
  windows: number | null;
  linux: number | null;
  tenantAttivi: number;
}

type Ruolo = "windows" | "ssh" | "linux" | "snmp";

export interface EsitoCatene {
  aggiunteLista: Array<{ network_id: number; credential_id: number; da: Ruolo | "globale" }>;
  righeHostDaPin: number;
  pinGiaPresenti: number;
  saltate: Array<{ network_id?: number; host_id?: number; credential_id: number; motivo: string }>;
}

/** Chiavi dell'hub non copiate perché i tenant attivi non sono uno solo: è la regola (D3), non un difetto. */
export const MOTIVO_DUE_TENANT = "due tenant attivi";

const RUOLI: readonly Ruolo[] = ["windows", "ssh", "linux", "snmp"];
const PROTOCOLLO: Record<Ruolo, CredProtocol> = { windows: "winrm", ssh: "ssh", linux: "ssh", snmp: "snmp" };

type RigaVecchia = { role: string; credential_id: number; credential_type: string | null };
type RigaPin = {
  host_id: number;
  role: string;
  credential_id: number;
  updated_at: string | null;
  credential_type: string | null;
  port: number | null;
  host_esiste: number;
};

function motivoTipo(tipo: string, ruolo: Ruolo): string {
  return `tipo «${tipo}» non vale per il ruolo ${ruolo}`;
}

/** Il ruolo, se la voce vale per lui; altrimenti il motivo per cui la riga si salta. */
function valuta(tipo: string | null, ruolo: string): { ruolo: Ruolo } | { motivo: string } {
  const noto = RUOLI.find((r) => r === ruolo);
  if (!noto) return { motivo: `ruolo «${ruolo}» sconosciuto` };
  if (tipo == null) return { motivo: "la voce non esiste nel tenant" };
  return tipiPerRuoloVecchio(noto).includes(tipo) ? { ruolo: noto } : { motivo: motivoTipo(tipo, noto) };
}

function conta(db: Database.Database, tabella: "network_credentials" | "host_credentials"): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${tabella}`).get() as { n: number }).n;
}

export function convertiCateneVecchie(db: Database.Database, globali: GlobaliHub | null, opzioni: { aVuoto: boolean }): EsitoCatene {
  return db.transaction((): EsitoCatene => {
    const esito: EsitoCatene = { aggiunteLista: [], righeHostDaPin: 0, pinGiaPresenti: 0, saltate: [] };
    const listaPrima = conta(db, "network_credentials");
    const hostPrima = conta(db, "host_credentials");
    const tipoDi = db.prepare("SELECT credential_type FROM credentials WHERE id = ?");

    // Chiavi dell'hub: una volta per chiave, prima delle reti.
    const chiavi: Array<{ id: number; ruolo: Ruolo }> = [];
    if (globali) {
      const candidate: Array<{ id: number | null; ruolo: Ruolo }> = [
        { id: globali.windows, ruolo: "windows" },
        { id: globali.linux, ruolo: "linux" },
      ];
      for (const { id, ruolo } of candidate) {
        if (id == null) continue;
        if (globali.tenantAttivi !== 1) {
          esito.saltate.push({ credential_id: id, motivo: MOTIVO_DUE_TENANT });
          continue;
        }
        const r = tipoDi.get(id) as { credential_type: string } | undefined;
        const v = valuta(r?.credential_type ?? null, ruolo);
        if ("motivo" in v) esito.saltate.push({ credential_id: id, motivo: v.motivo });
        else chiavi.push({ id, ruolo });
      }
    }

    // Senza le tabelle vecchie (tolte dalla 2g, o un tenant nato dopo) non c'è niente da convertire:
    // restano solo le chiavi dell'hub, se ci sono, e le regole di sempre.
    const conCatene = tabellaVisibile(db, "network_host_credentials");
    const conPin = tabellaVisibile(db, "host_detect_credential");

    // Reti: tutte se c'è una chiave dell'hub da copiare, altrimenti quelle con una catena vecchia;
    // in più le catene orfane (rete tolta con le chiavi esterne spente), che si saltano.
    const reti = conCatene
      ? (db
          .prepare(
            `SELECT id, 1 AS esiste FROM networks
               WHERE ? = 1 OR id IN (SELECT network_id FROM network_host_credentials)
             UNION
             SELECT DISTINCT network_id, 0 FROM network_host_credentials
               WHERE network_id NOT IN (SELECT id FROM networks)
             ORDER BY id`
          )
          .all(chiavi.length > 0 ? 1 : 0) as Array<{ id: number; esiste: number }>)
      : chiavi.length > 0
        ? (db.prepare("SELECT id, 1 AS esiste FROM networks ORDER BY id").all() as Array<{ id: number; esiste: number }>)
        : [];
    const presentiDi = db.prepare("SELECT credential_id FROM network_credentials WHERE network_id = ?");
    const maxDi = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM network_credentials WHERE network_id = ?");
    const vecchieStmt = conCatene
      ? db.prepare(
          `SELECT nhc.role, nhc.credential_id, c.credential_type
           FROM network_host_credentials nhc
           LEFT JOIN credentials c ON c.id = nhc.credential_id
           WHERE nhc.network_id = ?
           ORDER BY CASE nhc.role WHEN 'windows' THEN 0 WHEN 'ssh' THEN 1 WHEN 'linux' THEN 2 ELSE 3 END,
                    nhc.sort_order ASC, nhc.id ASC`
        )
      : null;
    const vecchieDi = { all: (networkId: number): RigaVecchia[] => (vecchieStmt ? (vecchieStmt.all(networkId) as RigaVecchia[]) : []) };
    const accoda = db.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)");

    for (const { id: networkId, esiste } of reti) {
      if (esiste === 0) {
        for (const r of vecchieDi.all(networkId) as RigaVecchia[]) {
          esito.saltate.push({ network_id: networkId, credential_id: r.credential_id, motivo: "la rete non esiste" });
        }
        continue;
      }
      const presenti = new Set((presentiDi.all(networkId) as Array<{ credential_id: number }>).map((r) => r.credential_id));
      let ordine = (maxDi.get(networkId) as { m: number }).m + 1;
      const metti = (credentialId: number, da: Ruolo | "globale"): void => {
        if (presenti.has(credentialId)) return;
        presenti.add(credentialId);
        if (!opzioni.aVuoto) accoda.run(networkId, credentialId, ordine);
        ordine++;
        esito.aggiunteLista.push({ network_id: networkId, credential_id: credentialId, da });
      };
      for (const r of vecchieDi.all(networkId) as RigaVecchia[]) {
        const v = valuta(r.credential_type, r.role);
        if ("motivo" in v) esito.saltate.push({ network_id: networkId, credential_id: r.credential_id, motivo: v.motivo });
        else metti(r.credential_id, v.ruolo);
      }
      for (const k of chiavi) metti(k.id, "globale");
    }

    // Pin → righe validate dell'host.
    const pins = conPin
      ? (db
          .prepare(
            `SELECT hdc.host_id, hdc.role, hdc.credential_id, hdc.updated_at, c.credential_type, c.port,
                    (SELECT COUNT(*) FROM hosts h WHERE h.id = hdc.host_id) AS host_esiste
             FROM host_detect_credential hdc
             LEFT JOIN credentials c ON c.id = hdc.credential_id
             ORDER BY hdc.host_id ASC,
                      CASE hdc.role WHEN 'windows' THEN 0 WHEN 'ssh' THEN 1 WHEN 'linux' THEN 2 ELSE 3 END`
          )
          .all() as RigaPin[])
      : [];
    const giaDi = db.prepare("SELECT 1 FROM host_credentials WHERE host_id = ? AND credential_id = ? AND protocol_type = ? LIMIT 1");
    const maxHost = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM host_credentials WHERE host_id = ?");
    const inserisci = db.prepare(
      `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, validated_at, sort_order, auto_detected)
       VALUES (?, ?, ?, ?, 1, COALESCE(?, datetime('now')), ?, 1)`
    );
    const nate = new Set<string>();
    const ordineHost = new Map<number, number>();
    for (const p of pins) {
      const v = p.host_esiste === 0 ? { motivo: "l'host non esiste" } : valuta(p.credential_type, p.role);
      if ("motivo" in v) {
        esito.saltate.push({ host_id: p.host_id, credential_id: p.credential_id, motivo: v.motivo });
        continue;
      }
      const protocollo = PROTOCOLLO[v.ruolo];
      const chiave = `${p.host_id}:${p.credential_id}:${protocollo}`;
      if (nate.has(chiave) || giaDi.get(p.host_id, p.credential_id, protocollo)) {
        esito.pinGiaPresenti++;
        continue;
      }
      nate.add(chiave);
      const ordine = ordineHost.get(p.host_id) ?? (maxHost.get(p.host_id) as { m: number }).m + 1;
      ordineHost.set(p.host_id, ordine + 1);
      if (!opzioni.aVuoto) {
        inserisci.run(p.host_id, p.credential_id, protocollo, portaCredenziale({ port: p.port }, protocollo), p.updated_at, ordine);
      }
      esito.righeHostDaPin++;
    }

    if (!opzioni.aVuoto) {
      const listaDopo = conta(db, "network_credentials");
      const hostDopo = conta(db, "host_credentials");
      if (listaDopo !== listaPrima + esito.aggiunteLista.length || hostDopo !== hostPrima + esito.righeHostDaPin) {
        throw new Error(
          `conteggi che non tornano: lista ${listaPrima} → ${listaDopo} (attese ${esito.aggiunteLista.length} in più), ` +
            `righe host ${hostPrima} → ${hostDopo} (attese ${esito.righeHostDaPin} in più)`
        );
      }
    }
    return esito;
  })();
}

/** Valore del segno `credenziali_t2_catene`: `parziale:` se si è saltato qualcosa per un motivo diverso da `MOTIVO_DUE_TENANT`. */
export function segnoCatene(e: EsitoCatene, quando: Date = new Date()): string {
  const stato = e.saltate.some((s) => s.motivo !== MOTIVO_DUE_TENANT) ? "parziale" : "done";
  const conteggi = [
    `lista=${e.aggiunteLista.length}`,
    `da_globale=${e.aggiunteLista.filter((a) => a.da === "globale").length}`,
    `host_da_pin=${e.righeHostDaPin}`,
    `pin_presenti=${e.pinGiaPresenti}`,
    `saltate=${e.saltate.length}`,
  ].join(",");
  return `${stato}:${quando.toISOString()}:${conteggi}`;
}

/** Una riga per il journal e per la risposta dell'import: per id, senza nomi. */
export function descriviCatene(e: EsitoCatene): string {
  const aggiunte = e.aggiunteLista.length
    ? ` [${e.aggiunteLista.map((a) => `rete #${a.network_id} +#${a.credential_id} (${a.da})`).join(", ")}]`
    : "";
  const dove = (s: EsitoCatene["saltate"][number]) =>
    s.network_id != null ? `rete #${s.network_id} ` : s.host_id != null ? `host #${s.host_id} ` : "chiave dell'hub ";
  const saltate = e.saltate.length ? ` [${e.saltate.map((s) => `${dove(s)}#${s.credential_id}: ${s.motivo}`).join("; ")}]` : "";
  return (
    `${e.aggiunteLista.length} voci nella lista${aggiunte}, righe host dai pin ${e.righeHostDaPin}, ` +
    `pin già presenti ${e.pinGiaPresenti}, saltate ${e.saltate.length}${saltate}`
  );
}

/** Le colonne che una riga di un bundle vecchio porta per ognuna delle due tabelle. */
const COLONNE_VECCHIE: Readonly<Record<TabellaCateneVecchie, readonly string[]>> = {
  network_host_credentials: ["id", "network_id", "credential_id", "role", "sort_order"],
  host_detect_credential: ["host_id", "role", "credential_id", "updated_at"],
};

/**
 * Per l'import di un bundle di prima della 2d (T26): le righe di catene
 * vecchie e pin del bundle vanno in tabelle TEMPORANEE con gli stessi nomi,
 * che nascondono quelle del DB se ci sono ancora; `fn` (la conversione) le
 * legge con le regole di sempre; alla fine le temporanee si tolgono. Così le
 * righe del bundle non finiscono in tabelle che nessuno legge più, e su un DB
 * senza le tabelle vecchie non si perdono in silenzio. Va chiamata dentro la
 * transazione della conversione: se `fn` lancia, si annulla tutto.
 */
export function conCateneDelBundle<T>(
  db: Database.Database,
  righe: Readonly<Record<TabellaCateneVecchie, ReadonlyArray<Record<string, unknown>>>>,
  fn: () => T
): T {
  db.exec(`CREATE TEMP TABLE network_host_credentials (id INTEGER, network_id INTEGER, credential_id INTEGER, role TEXT, sort_order INTEGER DEFAULT 0)`);
  try {
    db.exec(`CREATE TEMP TABLE host_detect_credential (host_id INTEGER, role TEXT, credential_id INTEGER, updated_at TEXT)`);
    try {
      for (const t of TABELLE_CATENE_VECCHIE) {
        const colonne = COLONNE_VECCHIE[t];
        const ins = db.prepare(`INSERT INTO temp.${t} (${colonne.join(", ")}) VALUES (${colonne.map(() => "?").join(", ")})`);
        for (const r of righe[t]) ins.run(...colonne.map((c) => (r[c] === undefined ? null : r[c])));
      }
      return fn();
    } finally {
      db.exec("DROP TABLE temp.host_detect_credential");
    }
  } finally {
    db.exec("DROP TABLE temp.network_host_credentials");
  }
}
