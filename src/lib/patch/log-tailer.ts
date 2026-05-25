/**
 * Patch Management — Log tailer (polling delta da log file Windows).
 *
 * Espone `pollLogDelta(tenantCode, operationId)` chiamato dall'API route
 * `/api/patch/operations/[id]/logs` per recuperare il delta di output
 * dell'operation in corso.
 *
 * Flusso:
 *   1. Carica `patch_operations` (status, host_id, log_offset, log_file_path)
 *   2. Se status terminale → nessuna nuova WinRM call, ritorna `finished=true`
 *   3. Throttle 2s in-memory per operationId → evita raffiche di chiamate
 *   4. Esegue `buildTailScript(opId, log_offset)` via `runWinrmCommand`
 *   5. Parse output `OFFSET=N\n---\n<delta>`, INSERT righe in `patch_operation_logs`,
 *      UPDATE `patch_operations.log_offset`
 *   6. Ritorna SOLO il delta delle righe nuove (non l'intero buffer)
 *
 * Anti-pattern (NON violare):
 *  - NO Promise.all parallelizzato su WinRM per più operation in una chiamata
 *  - NO setInterval / loop infinito interno (il polling è guidato dall'esterno)
 *  - NO marcare operation come `failed` se la WinRM call di tail fallisce
 *    (è polling secondario, non azione critica)
 *  - NO logging di password o stringhe contenenti payload sensibili
 *  - NO `decrypt()` raw — uso `loadWinrmCredentialsForHost` che fa `safeDecrypt`
 *
 * EXAMPLE USAGE (da API route F4):
 *   const result = await pollLogDelta('tenant1', 1287);
 *   // result.lines = solo nuove righe dall'ultimo offset
 *   // result.nextOffset = nuovo offset bytes (per il prossimo poll)
 *   // result.finished = true se status terminale
 */

import { runWinrmCommand } from "@/lib/devices/winrm-run";
import { getTenantDb } from "@/lib/db-tenant";
import { loadWinrmCredentialsForHost } from "./credentials";
import { buildTailScript } from "./ps-scripts";
import type { PatchStatus } from "./types";

export interface LogLine {
  ts: string;
  stream: "stdout" | "stderr" | "system";
  line: string;
}

export interface PollResult {
  /** SOLO il delta di questa chiamata (righe nuove dopo log_offset precedente). */
  lines: LogLine[];
  /** Nuovo offset bytes-based del log file remoto. */
  nextOffset: number;
  /** True se status operation è terminale (success/failed/reboot_pending/cancelled). */
  finished: boolean;
  /** Status corrente dell'operation. */
  status: PatchStatus;
}

const TERMINAL_STATUSES: ReadonlySet<PatchStatus> = new Set<PatchStatus>([
  "success",
  "failed",
  "reboot_pending",
  "cancelled",
]);

const THROTTLE_MS = 2_000;

/**
 * Throttle in-memory: lastPolledAt per operationId.
 * Map indipendente dal tenant (operationId è AUTOINCREMENT per tenant DB ma
 * concorrenza fra tenant diversi sullo stesso id è benigna: il check è
 * pessimistico, al massimo skippiamo una chiamata WinRM legittima).
 */
const lastPolled = new Map<number, number>();

interface OperationLite {
  host_id: number;
  status: PatchStatus;
  log_offset: number;
  log_file_path: string | null;
}

/**
 * Polla il log file remoto per `operationId` nel tenant `tenantCode` e
 * persiste l'eventuale delta in `patch_operation_logs`. Ritorna SOLO le
 * righe nuove più il nuovo offset, oltre allo status terminale.
 */
export async function pollLogDelta(
  tenantCode: string,
  operationId: number
): Promise<PollResult> {
  const db = getTenantDb(tenantCode);

  // 1. Carica operation
  const op = db
    .prepare(
      `SELECT host_id, status, log_offset, log_file_path
         FROM patch_operations
        WHERE id = ?`
    )
    .get(operationId) as OperationLite | undefined;

  if (!op) {
    throw new Error(`[patch/log-tailer] Operation ${operationId} non trovata`);
  }

  const status = op.status;
  const currentOffset = op.log_offset ?? 0;
  const isTerminal = TERMINAL_STATUSES.has(status);

  // 2. Status terminale → niente nuove chiamate WinRM
  if (isTerminal) {
    // Pulisce l'entry throttle per non accumulare nella mappa
    lastPolled.delete(operationId);
    return {
      lines: [],
      nextOffset: currentOffset,
      finished: true,
      status,
    };
  }

  // 3. Throttle 2s: se l'ultima poll è troppo recente, no WinRM call
  const now = Date.now();
  const last = lastPolled.get(operationId);
  if (last !== undefined && now - last < THROTTLE_MS) {
    return {
      lines: [],
      nextOffset: currentOffset,
      finished: false,
      status,
    };
  }
  // Marca subito (anche se WinRM fallisce, evitiamo retry burst)
  lastPolled.set(operationId, now);

  // 4. Carica credenziali WinRM per l'host. Se assenti: log + return vuoto.
  const creds = loadWinrmCredentialsForHost(db, op.host_id);
  if (!creds) {
    console.warn(
      `[patch/log-tailer] WinRM creds mancanti per op=${operationId} host=${op.host_id}`
    );
    return {
      lines: [],
      nextOffset: currentOffset,
      finished: false,
      status,
    };
  }

  // 5. Tail script + WinRM call. Try-catch: se fail, NO update DB, NO fail op.
  const script = buildTailScript(operationId, currentOffset);
  let stdout = "";
  try {
    stdout = await runWinrmCommand(
      creds.host,
      creds.port,
      creds.username,
      creds.password,
      script,
      true,
      creds.realm ?? ""
    );
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    // Mai loggare password/creds: solo opId, hostId, messaggio.
    console.error(
      `[patch/log-tailer] WinRM tail fallito op=${operationId} host=${op.host_id}: ${message.slice(0, 200)}`
    );
    return {
      lines: [],
      nextOffset: currentOffset,
      finished: false,
      status,
    };
  }

  // 6. Parse output: prima riga "OFFSET=N", separator "---", poi delta.
  const parsed = parseTailOutput(stdout, currentOffset);

  if (parsed.newOffset === currentOffset && parsed.deltaLines.length === 0) {
    // Nessuna riga nuova: niente DB write, niente UPDATE.
    return {
      lines: [],
      nextOffset: currentOffset,
      finished: false,
      status,
    };
  }

  // 7. Prepara righe LogLine (timestamp = adesso, stream = stdout)
  const tsIso = new Date().toISOString();
  const newLines: LogLine[] = parsed.deltaLines.map((line) => ({
    ts: tsIso,
    stream: "stdout" as const,
    line,
  }));

  // 8. Transaction: INSERT bulk + UPDATE log_offset
  const insertLog = db.prepare(
    `INSERT INTO patch_operation_logs (operation_id, ts, stream, line)
     VALUES (?, ?, ?, ?)`
  );
  const updateOffset = db.prepare(
    `UPDATE patch_operations SET log_offset = ? WHERE id = ?`
  );

  const txn = db.transaction((lines: LogLine[], offset: number) => {
    for (const l of lines) {
      insertLog.run(operationId, l.ts, l.stream, l.line);
    }
    updateOffset.run(offset, operationId);
  });

  try {
    txn(newLines, parsed.newOffset);
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.error(
      `[patch/log-tailer] DB write fallita op=${operationId}: ${message.slice(0, 200)}`
    );
    // Ritorna lines/offset comunque al chiamante: il prossimo poll riproverà
    // dal log_offset precedente (idempotenza garantita dal log_offset DB).
    return {
      lines: [],
      nextOffset: currentOffset,
      finished: false,
      status,
    };
  }

  return {
    lines: newLines,
    nextOffset: parsed.newOffset,
    finished: false, // status era non-terminale all'inizio: non rileggiamo
    status,
  };
}

/**
 * Pulisce la mappa throttle. Utility per garbage collection (es. chiamabile
 * quando un'operation viene marcata terminale dall'executor o cancellata).
 *
 * Senza argomento: clear globale (test/teardown).
 */
export function clearTailerThrottle(operationId?: number): void {
  if (operationId === undefined) {
    lastPolled.clear();
    return;
  }
  lastPolled.delete(operationId);
}

// ─── Parser output PS tail script ───────────────────────────────────────────

interface TailParseResult {
  newOffset: number;
  deltaLines: string[];
}

/**
 * Parse output di `buildTailScript`:
 *
 *   OFFSET=<n>\n
 *   ---\n
 *   <delta text>
 *
 * Robustezza:
 *  - Tollera CRLF / LF mix
 *  - Se non trova `OFFSET=` → ritorna { newOffset: fallback, deltaLines: [] }
 *  - Filtra righe vuote nel delta (Tee-Object aggiunge trailing newline)
 */
function parseTailOutput(
  raw: string,
  fallbackOffset: number
): TailParseResult {
  if (!raw || raw.length === 0) {
    return { newOffset: fallbackOffset, deltaLines: [] };
  }

  // Normalizza line endings
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  // Trova "OFFSET=N" come prima riga non vuota
  let offsetLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("OFFSET=")) {
      offsetLineIdx = i;
      break;
    }
    // Prima riga non vuota non è OFFSET= → output malformato.
    break;
  }

  if (offsetLineIdx < 0) {
    return { newOffset: fallbackOffset, deltaLines: [] };
  }

  const offsetStr = lines[offsetLineIdx].trim().substring("OFFSET=".length);
  const newOffset = Number.parseInt(offsetStr, 10);
  if (!Number.isFinite(newOffset) || newOffset < 0) {
    return { newOffset: fallbackOffset, deltaLines: [] };
  }

  // Trova separator "---" dopo l'OFFSET line
  let sepIdx = -1;
  for (let i = offsetLineIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      sepIdx = i;
      break;
    }
  }

  if (sepIdx < 0) {
    // Nessun separator: nessun delta (legittimo se OFFSET non è cambiato)
    return { newOffset, deltaLines: [] };
  }

  // Le righe dopo "---" sono il delta. Filtra vuote, taglia trailing.
  const deltaRaw = lines.slice(sepIdx + 1);
  const deltaLines: string[] = [];
  for (const l of deltaRaw) {
    if (l.length === 0) continue;
    deltaLines.push(l);
  }

  return { newOffset, deltaLines };
}
