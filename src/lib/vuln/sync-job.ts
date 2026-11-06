/**
 * Sync job CVE findings da scanner-edge → DB tenant DA-IPAM.
 *
 * Esegue in contesto `withTenant` (impostato dallo scheduler cron).
 * Idempotente: scan_runs ha UNIQUE(scanner_id, edge_scan_id), findings
 * sono append-only (archivio temporale).
 *
 * Strategia incrementale:
 *   1. legge singleton vuln_scanners (enabled=1, limit 1) — niente edge → noop
 *   2. GET /api/v1/scans?since=last_sync_at → lista scan finiti dopo l'ultimo poll
 *   3. per ogni scan nuovo: INSERT OR IGNORE in vuln_scan_runs
 *   4. GET /api/v1/cve?since=last_sync_at paginato → bulk insert in vuln_findings
 *   5. match host_id su (ip, network_id) — single match assegna, multi/zero NULL
 *   6. update last_sync_at; errori → last_error, non rilancia
 *
 * Rilievi a scansione aperta (06/11/2026, piano host lenti): in un passo separato (`sincronizzaInCorso`),
 * che non ferma mai la sincronia, la sonda dà i rilievi degli host già finiti di una scansione ancora
 * aperta. Stanno in un giro `status = 'in_corso'`, sostituiti per intero a ogni sincronia. Alla chiusura
 * il giro prende i definitivi di `/cve` e perde quelli in corso (vedi `chiusure` e `sinceEffettivo`).
 */

import { statoDelGiro } from "@/lib/vuln/esito-scansione";
import { normalizzaRilievoControllo, ripulisciRilieviControlli } from "@/lib/vuln/rilievi-controlli";
import { riallineaConteggioRilievi } from "@/lib/vuln/conteggio-rilievi";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { getNetworks } from "@/lib/db";
import {
  EdgeClientError,
  eSondaSenzaInCorso,
  listScans,
  pullFindings,
  pullRilieviInCorso,
  type EdgeFinding,
  type EdgeScan,
  type VulnScannerRow,
} from "./scanner-edge-client";
import { allineaReteEdge, pushHostsToEdge } from "./edge-subnet-bridge";

interface HostMatchRow {
  id: number;
  network_id: number;
}

function nowIso(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/** Le date della sonda e di `last_sync_at` si confrontano come testo «AAAA-MM-GG hh:mm:ss» (UTC). */
function normalizzaData(d: string): string {
  return d.replace("T", " ").slice(0, 19);
}

/** Dopo quante ore senza che la sonda lo dia più un giro aperto si chiude (parziale o errore). */
const ORE_GIRO_ORFANO = 48;
const PAGINA_RILIEVI = 1000;
const OFFSET_MASSIMO = 100000;

/**
 * Ripresa da capo (Edge cambia `gvm_report_id` a parità di id locale): i giri con quell'id locale ma
 * un altro UUID si staccano dall'id. Se erano `in_corso` hanno rilievi di una scansione che non esiste
 * più: si cancellano e il giro si chiude `superato` («ripresa da capo»), che `ultimaNonRiuscita`
 * non guarda: non è un guasto, e senza questo resterebbe orfano 48 ore e poi darebbe un falso allarme.
 */
export const MOTIVO_SUPERATO = "ripresa da capo";
function liberaIdLocale(db: ReturnType<typeof getTenantDb>, scannerId: number, edgeScanId: number, uid: string): void {
  const vecchi = db
    .prepare("SELECT id, status, edge_scan_uid FROM vuln_scan_runs WHERE scanner_id = ? AND edge_scan_id = ? AND COALESCE(edge_scan_uid, '') <> ?")
    .all(scannerId, edgeScanId, uid) as Array<{ id: number; status: string | null; edge_scan_uid: string | null }>;
  for (const v of vecchi) {
    if (v.status === "in_corso") {
      db.prepare("DELETE FROM vuln_findings WHERE scan_run_id = ?").run(v.id);
      db.prepare("UPDATE vuln_scan_runs SET status = 'superato', finished_at = ?, finding_count = 0, error_message = ?, edge_scan_id = NULL WHERE id = ?")
        .run(nowIso(), MOTIVO_SUPERATO, v.id);
      console.warn(`[vuln-sync] giro in corso #${v.id} superato: l'edge ha ripreso la scansione ${edgeScanId} da capo`);
    } else {
      db.prepare("UPDATE vuln_scan_runs SET edge_scan_id = NULL WHERE id = ?").run(v.id);
    }
  }
}

interface Chiusura {
  runId: number;
  scan: EdgeScan;
}

/**
 * Lookup `host_id` per (ip, network_id?). Restituisce id se match singolo,
 * altrimenti null (zero match o ambiguità).
 */
/**
 * Rilievi arrivati prima che l'host fosse in inventario: l'aggancio per IP si faceva solo all'arrivo e
 * restavano «senza match» per sempre (79994-ipam-3, 29/10/2026: la sonda aveva scansionato una rete che
 * DA-IPAM scopre solo dopo). A ogni sincronia si riagganciano, con la stessa regola di `matchHostId`:
 * un IP, un host solo.
 */
export function riagganciaHost(db: ReturnType<typeof getTenantDb>): number {
  return db
    .prepare(
      `UPDATE vuln_findings
          SET host_id = (SELECT h.id FROM hosts h WHERE h.ip = vuln_findings.ip)
        WHERE host_id IS NULL
          AND (SELECT COUNT(*) FROM hosts h WHERE h.ip = vuln_findings.ip) = 1`,
    )
    .run().changes;
}

function matchHostId(
  db: ReturnType<typeof getTenantDb>,
  ip: string,
  networkId: number | null,
): number | null {
  if (networkId !== null) {
    const r = db
      .prepare("SELECT id FROM hosts WHERE ip = ? AND network_id = ?")
      .get(ip, networkId) as HostMatchRow | undefined;
    if (r) return r.id;
  }
  const rows = db
    .prepare("SELECT id FROM hosts WHERE ip = ?")
    .all(ip) as HostMatchRow[];
  return rows.length === 1 ? rows[0].id : null;
}

export async function runVulnSync(): Promise<{
  ok: boolean;
  newScans: number;
  newFindings: number;
  error?: string;
}> {
  const db = getTenantDb(getCurrentTenantCode() ?? "DEFAULT");

  const scanner = db
    .prepare(
      "SELECT id, name, base_url, token_encrypted, enabled, last_sync_at, last_error, consecutive_errors " +
        "FROM vuln_scanners WHERE enabled = 1 LIMIT 1",
    )
    .get() as VulnScannerRow | undefined;
  if (!scanner) {
    return { ok: true, newScans: 0, newFindings: 0 };
  }

  // Prima di parlare con la sonda: se la sonda non risponde il resto salta, la correzione delle righe già salvate no.
  try {
    ripulisciRilieviControlli(db);
  } catch (e) {
    console.error("[vuln-sync] correzione dei rilievi Edge-C non riuscita:", e instanceof Error ? e.message : e);
  }

  const since = scanner.last_sync_at ?? undefined;
  let newScans = 0;
  let newFindings = 0;

  try {
    // Le fallite senza `since`: una scansione fermata prima di un aggiornamento dell'edge arriva lo
    // stesso, l'UUID evita i doppioni. Un edge vecchio ignora `stato` e rimanda le riuscite.
    const fallite = (await listScans(scanner, undefined, "error")).filter((s) => s.status === "error");
    const scans: EdgeScan[] = [...(await listScans(scanner, since)), ...fallite];

    // Giri rimasti `in_corso` da una sincronia precedente: la sonda può averli chiusi fra l'elenco dei
    // running e la fine di quella sincronia (finished_at <= last_sync_at), e allora `since` non li
    // elenca più. Si chiedono senza `since`, solo per questi, e solo se ce ne sono.
    const apertiLocali = db
      .prepare("SELECT edge_scan_uid FROM vuln_scan_runs WHERE scanner_id = ? AND status = 'in_corso' AND edge_scan_uid IS NOT NULL")
      .all(scanner.id) as Array<{ edge_scan_uid: string }>;
    if (apertiLocali.length > 0) {
      const uids = new Set(apertiLocali.map((r) => r.edge_scan_uid));
      const visti = new Set(scans.map((x) => x.gvm_report_id).filter((u): u is string => !!u));
      for (const chiusa of await listScans(scanner)) {
        const u = chiusa.gvm_report_id;
        if (u && uids.has(u) && !visti.has(u)) scans.push(chiusa);
      }
    }

    // network_id qui resta NULL: l'ID arrivato dall'edge è dello *suo*
    // namespace e non corrisponde a `networks.id` lato IPAM. Il match host
    // viene fatto per IP a valle (vedi matchHostId). Eventuale mapping
    // per CIDR è ottimizzazione futura.
    // NB: dedup sull'UUID Greenbone (`gvm_report_id`), non sull'`id` locale
    // dell'edge. L'id locale riparte da 1 se l'edge viene ricostruito e
    // collide con lo storico: con `INSERT OR IGNORE` + UNIQUE(scanner_id,
    // edge_scan_id) gli scan nuovi venivano scartati IN SILENZIO e i loro
    // findings attribuiti a run vecchi (incident cliente A 2026-07, scoperto solo
    // dopo settimane). Qui: mai ignorare in silenzio.
    const insertScanRun = db.prepare(
      `INSERT INTO vuln_scan_runs
        (scanner_id, edge_scan_id, edge_scan_uid, network_id, started_at,
         finished_at, finding_count, status, error_message)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    );
    const findByUid = db.prepare(
      "SELECT id, status FROM vuln_scan_runs WHERE scanner_id = ? AND edge_scan_uid = ?",
    );
    const findByLocalId = db.prepare(
      "SELECT id, edge_scan_uid, status FROM vuln_scan_runs WHERE scanner_id = ? AND edge_scan_id = ?",
    );

    const scanRunByEdgeId = new Map<number, { runId: number; networkId: number | null }>();
    const chiusure: Chiusura[] = [];
    for (const s of scans) {
      const uid = s.gvm_report_id ?? null;

      // già importato? (per UUID se disponibile, altrimenti per id locale)
      const already = (uid
        ? findByUid.get(scanner.id, uid)
        : findByLocalId.get(scanner.id, s.id)) as { id: number; status: string | null } | undefined;
      if (already) {
        scanRunByEdgeId.set(s.id, { runId: already.id, networkId: s.network_id });
        // Un giro tenuto aperto che la sonda ora dà chiuso: si completa DOPO il pull dei definitivi.
        if (already.status === "in_corso" && s.status !== "running" && !chiusure.some((c) => c.runId === already.id)) {
          chiusure.push({ runId: already.id, scan: s });
        }
        continue;
      }

      // Collisione: esiste un run con lo stesso id locale ma UUID diverso →
      // l'edge è stato ricostruito (o ha ripreso la scansione da capo) e ha riusato l'id. Sgancio l'id
      // locale dal run storico (i suoi dati restano, identificati dall'UUID) così il vincolo UNIQUE non
      // fa perdere lo scan nuovo; un giro vecchio ancora `in_corso` si chiude `superato`.
      if (uid) liberaIdLocale(db, scanner.id, s.id, uid);

      try {
        const info = insertScanRun.run(
          scanner.id,
          s.id,
          uid,
          s.started_at,
          s.finished_at,
          s.finding_count,
          statoDelGiro(s),
          s.error_message ?? null,
        );
        // networkId qui mantengo come arriva dall'edge perché serve solo
        // come hint per matchHostId (lookup hosts per ip+network_id IPAM
        // se conosciuto). Per IPAM è informativo, non FK.
        scanRunByEdgeId.set(s.id, {
          runId: Number(info.lastInsertRowid),
          networkId: s.network_id,
        });
        newScans++;
      } catch (e) {
        // Mai perdere lo scan in silenzio: logga e prosegui con gli altri.
        console.error(
          `[vuln-sync] insert scan_run fallito (edge_scan_id=${s.id}, uid=${uid}):`,
          (e as Error).message,
        );
      }
    }

    // Paginazione findings dall'edge fino a esaurimento
    let offset = 0;
    const limit = 1000;
    const insertFinding = db.prepare(
      `INSERT INTO vuln_findings
        (host_id, scan_run_id, ip, mac, hostname, port, service,
         cve_id, cvss_score, cvss_vector, severity,
         nvt_oid, nvt_name, description, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Lookup riusabile: per finding il cui edge_scan_id non era nello
    // snapshot di listScans(since), cerca in vuln_scan_runs già esistente.
    // Tipico col backfill retroattivo: i findings nuovi puntano a scan
    // run già importati in passi precedenti.
    const findRunByEdgeId = db.prepare(
      "SELECT id, network_id FROM vuln_scan_runs WHERE scanner_id = ? AND edge_scan_id = ?",
    );

    // `since` per i giri che chiudono. I definitivi hanno `scanned_at = datetime('now')` della sonda al
    // parse (parse_cve.py), cioè alla chiusura; `last_sync_at` lo scrive la sincronia a fine corsa. Se la
    // scansione chiude mentre quella sincronia gira, `scanned_at <= last_sync_at` e col solo `since` i
    // definitivi non arriverebbero mai (e i rilievi in corso, cancellati, sarebbero persi). Quindi per
    // questa sincronia `since` scende a poco prima della partenza del giro più vecchio fra quelli che
    // chiudono (stesso orologio della sonda); ma la fascia in più (sinceEffettivo, since] può contenere
    // rilievi già importati di altri giri, append-only: lì si accettano solo quelli dei giri che chiudono.
    const sinceNorm = since ? normalizzaData(since) : undefined;
    let sinceEffettivo = since;
    if (since && chiusure.length > 0) {
      const partenze = chiusure.map((c) => (c.scan.started_at ? Date.parse(normalizzaData(c.scan.started_at).replace(" ", "T") + "Z") : NaN));
      if (partenze.some((t) => Number.isNaN(t))) {
        sinceEffettivo = undefined; // partenza illeggibile: nessun limite, il filtro per giro evita i doppioni
      } else {
        const prima = normalizzaData(new Date(Math.min(...partenze) - 1000).toISOString());
        if (prima < normalizzaData(since)) sinceEffettivo = prima;
      }
    }
    const filtraFascia = sinceEffettivo !== since;
    const edgeIdChiusi = new Set(chiusure.map((c) => c.scan.id));
    const cancellaDelGiro = db.prepare("DELETE FROM vuln_findings WHERE scan_run_id = ?");
    // Giri da pulire al primo definitivo che arriva per loro: quelli che chiudono e ogni altro giro
    // `in_corso` (altrimenti rilievi in corso e definitivi si sommerebbero). Un giro per cui /cve non
    // porta righe non si tocca: i suoi rilievi in corso sono tutto quello che c'è (vedi più sotto).
    const daPulire = new Set<number>(chiusure.map((c) => c.runId));
    for (const r of db.prepare("SELECT id FROM vuln_scan_runs WHERE scanner_id = ? AND status = 'in_corso'").all(scanner.id) as Array<{ id: number }>) {
      daPulire.add(r.id);
    }
    const righePerGiro = new Map<number, number>();

    // Transaction wrapper per bulk insert
    const insertMany = db.transaction((findings: EdgeFinding[]) => {
      for (const grezzo of findings) {
        const f = normalizzaRilievoControllo(grezzo);
        if (filtraFascia && !edgeIdChiusi.has(f.scan_id) && !(sinceNorm && normalizzaData(f.scanned_at) > sinceNorm)) continue;
        let runRef = scanRunByEdgeId.get(f.scan_id);
        if (!runRef) {
          const r = findRunByEdgeId.get(scanner.id, f.scan_id) as
            | { id: number; network_id: number | null }
            | undefined;
          if (!r) continue;
          runRef = { runId: r.id, networkId: r.network_id };
          scanRunByEdgeId.set(f.scan_id, runRef);
        }
        // Primo definitivo del giro: via i rilievi in corso e gli eventuali definitivi di un tentativo
        // interrotto, il giro si rifà da zero.
        if (daPulire.delete(runRef.runId)) cancellaDelGiro.run(runRef.runId);
        righePerGiro.set(runRef.runId, (righePerGiro.get(runRef.runId) ?? 0) + 1);
        const hostId = matchHostId(db, f.ip, f.network_id ?? runRef.networkId);
        insertFinding.run(
          hostId,
          runRef.runId,
          f.ip,
          f.mac,
          f.hostname,
          f.port,
          f.service,
          f.cve_id,
          f.cvss_score,
          f.cvss_vector,
          f.severity,
          f.nvt_oid,
          f.nvt_name,
          f.description,
          f.scanned_at,
        );
        newFindings++;
      }
    });

    while (true) {
      const page = await pullFindings(scanner, { since: sinceEffettivo, offset, limit });
      insertMany(page.items);
      if (page.items.length === 0) break;
      if (page.next_offset === null) break;
      offset = page.next_offset;
      if (offset > 100000) {
        // safety: protezione runaway, oltre questo soglia c'è un bug
        console.warn(`[vuln-sync] offset > 100k su scanner ${scanner.id}, abort`);
        break;
      }
    }

    // Pull finito senza errori: i giri che chiudevano chiudono davvero. Se il pull fosse fallito sarebbero
    // rimasti `in_corso` e il prossimo giro li rifarebbe da zero.
    const chiudi = db.prepare(
      "UPDATE vuln_scan_runs SET status = ?, finished_at = ?, finding_count = ?, error_message = ? WHERE id = ?",
    );
    const contaDelGiro = db.prepare("SELECT COUNT(*) AS n FROM vuln_findings WHERE scan_run_id = ?");
    for (const c of chiusure) {
      // Edge scrive lo stato prima dei rilievi definitivi (error, zero rilievi, /cve ancora vuoto): se
      // /cve non ha portato righe per il giro e quelli in corso non sono zero, il giro resta `in_corso`
      // fino alla sincronia dopo (e `sinceEffettivo` resta abbassato finché non è chiuso). Se i
      // definitivi non arrivano mai, dopo 48 ore la regola dei giri orfani lo chiude `parziale`.
      const arrivate = righePerGiro.get(c.runId) ?? 0;
      if (arrivate === 0 && (contaDelGiro.get(c.runId) as { n: number }).n > 0) continue;
      chiudi.run(statoDelGiro(c.scan), c.scan.finished_at, c.scan.finding_count, c.scan.error_message ?? null, c.runId);
    }
    // Definitivi arrivati per un giro già chiuso `error` (scritto prima dei rilievi): vale per gli host
    // finiti, come una scansione fermata; senza questo `vuln_findings_attuali` li escluderebbe.
    const riallinea = db.prepare("UPDATE vuln_scan_runs SET status = 'parziale' WHERE id = ? AND status = 'error'");
    for (const runId of righePerGiro.keys()) riallinea.run(runId);

    ripulisciRilieviControlli(db);
    riagganciaHost(db);
    /* Il `finding_count` della sonda conta solo i rilievi Greenbone (04/11/2026):
     * qui si riallinea a quello che abbiamo davvero scaricato. La misura che
     * l'ha mostrato sta in `conteggio-rilievi.ts`. */
    const contiCorretti = riallineaConteggioRilievi(db, scanner.id);
    if (contiCorretti > 0) {
      console.info(`[vuln-sync] finding_count riallineato su ${contiCorretti} giri dello scanner ${scanner.id}`);
    }

    // Rilievi a scansione aperta: passo a sé, mai un errore per la sincronia (vedi la funzione).
    await sincronizzaInCorso(db, scanner);

    // Push-hosts periodico: aggiorna inventario sull'edge per le reti con
    // targeting_mode dinamico (found_ips / populated_24). Le reti full_subnet
    // non ne hanno bisogno (scansionano l'intero CIDR direttamente).
    // Best-effort: un singolo fallimento non blocca il resto del job né il sync.
    // Nota: iteriamo su tutte le reti con targeting_mode ≠ full_subnet senza
    // verificare se la rete ha uno schedule edge attivo (quella info richiederebbe
    // un round-trip verso l'edge per ogni rete). La scelta è conservativa:
    // si fa push anche per reti senza schedule — overhead trascurabile, nessun danno.
    const allNetworks = getNetworks();
    for (const net of allNetworks) {
      const mode = net.targeting_mode ?? "full_subnet";
      if (mode === "full_subnet") continue;
      try {
        await pushHostsToEdge(net.id);
      } catch (pushErr) {
        // Log solo metadati (no IP/hostname): per EdgeClientError logghiamo
        // solo lo status HTTP, non il body (può echeggiare campi della richiesta).
        const msg =
          pushErr instanceof EdgeClientError
            ? `edge HTTP ${pushErr.status}`
            : pushErr instanceof Error
              ? pushErr.message
              : "errore sconosciuto";
        console.warn(`[vuln-sync] push-hosts rete #${net.id} (${mode}) fallito: ${msg}`);
      }
    }

    // Un legame di credenziali perso non torna da solo: i giri pianificati partono dalla sonda
    // (72729, 05/11/2026). Stesso trattamento degli errori qui sopra: mai il corpo della risposta.
    for (const net of allNetworks) {
      try {
        if (await allineaReteEdge(net.id)) {
          console.log(`[vuln-sync] impianti e credenziali allineati sulla sonda per la rete #${net.id}`);
        }
      } catch (credErr) {
        const msg = credErr instanceof EdgeClientError ? `edge HTTP ${credErr.status}` : "errore sconosciuto";
        console.warn(`[vuln-sync] rete #${net.id} non allineata sulla sonda: ${msg}`);
      }
    }

    // v0.2.638 audit B7: success → azzera counter consecutive_errors.
    db.prepare(
      "UPDATE vuln_scanners SET last_sync_at = ?, last_error = NULL, consecutive_errors = 0, auto_disabled_at = NULL, updated_at = datetime('now') WHERE id = ?",
    ).run(nowIso(), scanner.id);

    return { ok: true, newScans, newFindings };
  } catch (e) {
    const msg =
      e instanceof EdgeClientError
        ? `edge ${e.status}: ${e.message}`
        : (e as Error).message;
    // v0.2.638 audit B7: incrementa counter; a 5 errori consecutivi auto-disable
    // lo scanner per fermare il rumore (cron muto per ore su TOFU mismatch).
    // L'utente vede `auto_disabled_at` + `last_error` chiaro per riattivare manualmente.
    const AUTO_DISABLE_THRESHOLD = 5;
    const newCount = (scanner.consecutive_errors ?? 0) + 1;
    if (newCount >= AUTO_DISABLE_THRESHOLD) {
      db.prepare(
        `UPDATE vuln_scanners
         SET last_error = ?, consecutive_errors = ?, enabled = 0, auto_disabled_at = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        `Auto-disabilitato dopo ${newCount} errori consecutivi: ${msg}`.slice(0, 500),
        newCount,
        nowIso(),
        scanner.id,
      );
    } else {
      db.prepare(
        "UPDATE vuln_scanners SET last_error = ?, consecutive_errors = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(msg.slice(0, 500), newCount, scanner.id);
    }
    return { ok: false, newScans, newFindings, error: msg };
  }
}

/**
 * Rilievi degli host finiti di una scansione ancora aperta. Mai un errore per la sincronia: una sonda
 * vecchia (404/422) si salta, ogni altro guasto si scrive nel log e `last_sync_at`, `last_error` e i
 * contatori dello scanner restano quelli del flusso normale.
 *
 * Per ogni scansione `running` con UUID: giro `in_corso` (uno solo per UUID), tutte le pagine di
 * `/rilievi-in-corso` raccolte PRIMA della transazione, poi cancellazione e riscrittura dei rilievi del
 * giro in un colpo solo: una pagina che fallisce non cancella niente. Una lista vuota con rilievi già
 * tenuti vuol dire che la scansione ha chiuso fra l'elenco e la richiesta: si lascia com'è, i
 * definitivi arrivano alla prossima sincronia.
 */
async function sincronizzaInCorso(db: ReturnType<typeof getTenantDb>, scanner: VulnScannerRow): Promise<void> {
  try {
    let running: EdgeScan[];
    try {
      // Un edge ancora più vecchio ignora `stato` e rimanda le chiuse: il filtro le scarta.
      running = (await listScans(scanner, undefined, "running")).filter((s) => s.status === "running");
    } catch (e) {
      if (eSondaSenzaInCorso(e)) return; // sonda da aggiornare, niente di rotto
      throw e;
    }

    const findByUid = db.prepare("SELECT id, status, network_id FROM vuln_scan_runs WHERE scanner_id = ? AND edge_scan_uid = ?");
    const insertRun = db.prepare(
      `INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, edge_scan_uid, network_id, started_at, finished_at, finding_count, status, error_message)
       VALUES (?, ?, ?, NULL, ?, NULL, ?, 'in_corso', NULL)`,
    );
    const cancellaDelGiro = db.prepare("DELETE FROM vuln_findings WHERE scan_run_id = ?");
    const contaDelGiro = db.prepare("SELECT COUNT(*) AS n FROM vuln_findings WHERE scan_run_id = ?");
    const aggiornaConteggio = db.prepare("UPDATE vuln_scan_runs SET finding_count = ? WHERE id = ?");
    const insertFinding = db.prepare(
      `INSERT INTO vuln_findings
        (host_id, scan_run_id, ip, mac, hostname, port, service,
         cve_id, cvss_score, cvss_vector, severity,
         nvt_oid, nvt_name, description, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const sostituisci = db.transaction((runId: number, networkId: number | null, items: EdgeFinding[]) => {
      cancellaDelGiro.run(runId);
      for (const grezzo of items) {
        const f = normalizzaRilievoControllo(grezzo);
        insertFinding.run(
          matchHostId(db, f.ip, f.network_id ?? networkId), runId, f.ip, f.mac, f.hostname, f.port, f.service,
          f.cve_id, f.cvss_score, f.cvss_vector, f.severity, f.nvt_oid, f.nvt_name, f.description, f.scanned_at,
        );
      }
      aggiornaConteggio.run(items.length, runId);
    });

    const uidVisti = new Set<string>();
    for (const s of running) {
      const uid = s.gvm_report_id;
      if (!uid) continue; // appena partita: il report Greenbone non c'è ancora, si riprende alla prossima
      uidVisti.add(uid);
      try {
        let run = findByUid.get(scanner.id, uid) as { id: number; status: string | null; network_id: number | null } | undefined;
        if (run && run.status !== "in_corso") continue; // già chiusa e importata dal flusso normale
        if (!run) {
          liberaIdLocale(db, scanner.id, s.id, uid);
          const info = insertRun.run(scanner.id, s.id, uid, s.started_at, s.finding_count ?? 0);
          run = { id: Number(info.lastInsertRowid), status: "in_corso", network_id: null };
        }

        const items: EdgeFinding[] = [];
        let offset = 0;
        for (;;) {
          const pagina = await pullRilieviInCorso(scanner, s.id, { offset, limit: PAGINA_RILIEVI });
          items.push(...pagina.items);
          if (pagina.next_offset === null || pagina.items.length === 0) break;
          offset = pagina.next_offset;
          if (offset > OFFSET_MASSIMO) throw new Error(`offset > ${OFFSET_MASSIMO} sui rilievi in corso`);
        }
        const tenuti = (contaDelGiro.get(run.id) as { n: number }).n;
        if (items.length === 0 && tenuti > 0) continue;
        sostituisci(run.id, s.network_id, items);
      } catch (e) {
        // Un giro che non si legge non ferma gli altri né la sincronia; i rilievi già tenuti restano.
        const msg = e instanceof EdgeClientError ? `edge HTTP ${e.status}` : e instanceof Error ? e.message : "errore sconosciuto";
        console.warn(`[vuln-sync] rilievi in corso della scansione ${s.id} non letti: ${msg}`);
      }
    }

    // Un giro aperto che la sonda non dà più (scansione cancellata, sonda ricostruita) non resta aperto
    // per sempre. I rilievi tenuti sono di host finiti e sono veri: si tengono, il giro diventa
    // `parziale` (o `error` se non ne ha), come una scansione fermata.
    const limite = normalizzaData(new Date(Date.now() - ORE_GIRO_ORFANO * 3600_000).toISOString());
    const aperti = db
      .prepare("SELECT id, edge_scan_uid, COALESCE(started_at, pulled_at) AS partito FROM vuln_scan_runs WHERE scanner_id = ? AND status = 'in_corso'")
      .all(scanner.id) as Array<{ id: number; edge_scan_uid: string | null; partito: string | null }>;
    const chiudiOrfano = db.prepare("UPDATE vuln_scan_runs SET status = ?, finished_at = ?, error_message = ? WHERE id = ?");
    for (const r of aperti) {
      if ((r.edge_scan_uid && uidVisti.has(r.edge_scan_uid)) || !r.partito || normalizzaData(r.partito) >= limite) continue;
      const n = (contaDelGiro.get(r.id) as { n: number }).n;
      chiudiOrfano.run(
        n > 0 ? "parziale" : "error",
        nowIso(),
        `La sonda non dà più la scansione da oltre ${ORE_GIRO_ORFANO} ore: giro chiuso senza esito` + (n > 0 ? "; tenuti i rilievi degli host finiti" : ""),
        r.id,
      );
    }
    riagganciaHost(db);
  } catch (e) {
    const msg = e instanceof EdgeClientError ? `edge HTTP ${e.status}` : e instanceof Error ? e.message : "errore sconosciuto";
    console.warn(`[vuln-sync] rilievi a scansione aperta non sincronizzati: ${msg}`);
  }
}
