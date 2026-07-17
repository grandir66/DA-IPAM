/**
 * Esecuzione comandi remoti sugli endpoint (Fase 2 RMM).
 *
 * Risolve il nodo MeshCentral dall'hostId, esegue via control.ashx e registra
 * l'audit. E' ESECUZIONE DI CODICE REMOTO: la rotta chiama requireAdmin e qui
 * si tiene traccia di chi ha eseguito cosa, anche in caso di errore.
 *
 * L'output NON viene mai persistito né loggato: puo' contenere password, token o
 * dati del cliente (basta un `cat .env`). Vive solo nella risposta HTTP
 * all'operatore che ha lanciato il comando. In `mc_command_log` restano comando
 * ed esito. Stesso principio di mc_remote_session, che non salva mai il token.
 */
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { getMeshCreds } from "./config";
import { MeshControlClient } from "./control-client";

export interface RunCommandInput {
  hostId: number;
  command: string;
  /** true = PowerShell (solo Windows). false/assente = auto per piattaforma. */
  powershell?: boolean;
  /** 0 SYSTEM/root (default) · 1 come utente se possibile · 2 solo utente. */
  runAsUser?: 0 | 1 | 2;
  operator: string;
}

export type RunCommandResult =
  | { ok: true; output: string }
  | { ok: false; status: number; error: string };

/** Limite di lunghezza: evita di spedire payload assurdi al control WebSocket. */
const MAX_COMMAND_LEN = 8_000;

/**
 * NB: nessuna sanitizzazione del comando — sarebbe teatro. La funzione ESISTE per
 * eseguire comandi arbitrari come root/SYSTEM: qualunque blacklist darebbe una
 * falsa sensazione di sicurezza aggirabile in dieci modi. Il controllo vero e'
 * a monte: requireAdmin sulla rotta + audit di chi ha eseguito cosa.
 * Il comando NON viene interpolato in una shell da noi: viaggia come stringa JSON
 * fino all'agente, quindi non c'e' rischio di injection nel nostro layer.
 */
export async function runRemoteCommand(input: RunCommandInput): Promise<RunCommandResult> {
  const code = getCurrentTenantCode();
  if (!code) return { ok: false, status: 401, error: "Nessun contesto tenant" };

  const cmd = input.command.trim();
  if (!cmd) return { ok: false, status: 400, error: "Comando vuoto" };
  if (cmd.length > MAX_COMMAND_LEN) {
    return { ok: false, status: 400, error: `Comando troppo lungo (max ${MAX_COMMAND_LEN} caratteri)` };
  }

  const db = getTenantDb(code);
  const node = db
    .prepare(
      `SELECT node_id, conn
         FROM mc_node
        WHERE host_id = ? AND match_status IN ('matched', 'manual')
        ORDER BY conn DESC, synced_at DESC
        LIMIT 1`,
    )
    .get(input.hostId) as { node_id: string; conn: number } | undefined;

  if (!node) {
    return { ok: false, status: 404, error: "Nessun agente MeshCentral associato a questo host" };
  }
  if (node.conn !== 1) {
    // Meglio dirlo subito che aspettare 30s di timeout sul control WebSocket.
    return { ok: false, status: 409, error: "L'agente risulta offline: comando non eseguibile" };
  }

  const creds = getMeshCreds();
  if (!creds) return { ok: false, status: 412, error: "MeshCentral non configurato" };

  const shell = input.powershell ? "powershell" : "auto";
  const runAsUser = input.runAsUser ?? 0;
  const client = new MeshControlClient(creds);
  try {
    const output = await client.runCommand(node.node_id, cmd, {
      powershell: input.powershell,
      runAsUser,
    });
    recordCommand(db, input, node.node_id, shell, runAsUser, "ok", null);
    return { ok: true, output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // L'audit va scritto ANCHE quando fallisce: un tentativo di esecuzione
    // remota e' un fatto rilevante di per se', a prescindere dall'esito.
    recordCommand(db, input, node.node_id, shell, runAsUser, "error", message);
    return { ok: false, status: 502, error: `Esecuzione fallita: ${message}` };
  } finally {
    // Senza close() le richieste in volo restano appese e il socket perde.
    client.close();
  }
}

function recordCommand(
  db: ReturnType<typeof getTenantDb>,
  input: RunCommandInput,
  nodeId: string,
  shell: string,
  runAsUser: number,
  status: "ok" | "error",
  error: string | null,
): void {
  try {
    db.prepare(
      `INSERT INTO mc_command_log (host_id, node_id, operator, command, shell, run_as_user, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(input.hostId, nodeId, input.operator, input.command, shell, runAsUser, status, error);
  } catch (e) {
    // L'audit non deve far fallire l'operazione: il comando e' gia' stato
    // eseguito sull'endpoint, nascondere l'esito all'operatore sarebbe peggio.
    console.warn("[meshcentral/run-command] audit non scritto:", (e as Error)?.message);
  }
}
