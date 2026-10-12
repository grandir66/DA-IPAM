// Il ping ha tre esiti (T3-19, INV-2): vivo, nessuna risposta, sconosciuto.
// Un ping che non può girare (binario assente, permessi, errore di rete
// locale) non vuol dire «host spento»: l'IP resta com'era e, se nessun IP ha
// avuto un esito vero, il giro fallisce senza toccare gli host.
//
// Le forme degli errori sono quelle di un `execFile` vero, ricavate una volta
// il 13/10 su macOS: spawn mancante → code "ENOENT", errno -2, syscall
// "spawn …"; file non eseguibile → code "EACCES"; uscita non zero → code
// numerico, killed false, signal null; timeout → code null, killed true,
// signal "SIGTERM".
//
// Lanciare con una cartella di prova:
//   DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX") node --import tsx --test src/lib/scanner/__tests__/ping-esiti.test.ts
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { tentativiBloccati, togliGuardiaRete } from "./support/guardia-rete";
import { test, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { classifyPingError } from "@/lib/scanner/ping";
import { discoverNetwork, getScanProgress } from "@/lib/scanner/discovery";
import { runKnownHostCheck } from "@/lib/cron/jobs";
import { creaEsecutoreFinto, installaEsecutoreFinto, togliEsecutoreFinto } from "./support/esecutore-finto";

function errSpawn(code: "ENOENT" | "EACCES"): NodeJS.ErrnoException {
  return Object.assign(new Error(`spawn ping ${code}`), {
    code,
    errno: code === "ENOENT" ? -2 : -13,
    syscall: "spawn ping",
    path: "ping",
  });
}

function errUscita(code: number): Error {
  return Object.assign(new Error(`Command failed: ping`), { code, killed: false, signal: null, stdout: "", stderr: "" });
}

function errTimeout(): Error {
  return Object.assign(new Error(`Command failed: ping`), { code: null, killed: true, signal: "SIGTERM", stdout: "", stderr: "" });
}

describe("classifyPingError", () => {
  test("nessun errore → vivo", () => {
    assert.equal(classifyPingError(null, "linux").esito, "vivo");
  });

  test("ping assente o non eseguibile → sconosciuto, su ogni piattaforma", () => {
    for (const piatt of ["linux", "darwin"] as const) {
      for (const code of ["ENOENT", "EACCES"] as const) {
        const r = classifyPingError(errSpawn(code), piatt);
        assert.equal(r.esito, "sconosciuto", `${code} su ${piatt}`);
        assert.match(r.errore ?? "", new RegExp(code));
      }
    }
  });

  test("Linux: exit 1 → nessuna risposta, exit 2 → sconosciuto", () => {
    assert.equal(classifyPingError(errUscita(1), "linux").esito, "nessuna_risposta");
    const due = classifyPingError(errUscita(2), "linux");
    assert.equal(due.esito, "sconosciuto");
    assert.match(due.errore ?? "", /2/);
  });

  test("macOS: exit 2 → nessuna risposta, altri codici → sconosciuto", () => {
    assert.equal(classifyPingError(errUscita(2), "darwin").esito, "nessuna_risposta");
    assert.equal(classifyPingError(errUscita(68), "darwin").esito, "sconosciuto");
  });

  test("processo terminato per timeout → nessuna risposta", () => {
    assert.equal(classifyPingError(errTimeout(), "linux").esito, "nessuna_risposta");
    assert.equal(classifyPingError(errTimeout(), "darwin").esito, "nessuna_risposta");
  });

  test("processo ucciso da fuori (segnale senza timeout) → sconosciuto", () => {
    // OOM killer o SIGTERM al gruppo: execFile riporta killed false e il segnale.
    const ucciso = Object.assign(new Error("Command failed: ping"), {
      code: null, killed: false, signal: "SIGKILL", stdout: "", stderr: "",
    });
    const r = classifyPingError(ucciso, "linux");
    assert.equal(r.esito, "sconosciuto");
    assert.match(r.errore ?? "", /SIGKILL/);
  });

  test("errore senza forma riconoscibile → sconosciuto", () => {
    assert.equal(classifyPingError(new Error("boh"), "linux").esito, "sconosciuto");
    assert.equal(classifyPingError("stringa", "linux").esito, "sconosciuto");
  });
});

const T = "TESTPINGESITI";

createTenant({
  codice_cliente: T,
  ragione_sociale: "Banco esiti ping",
  indirizzo: null,
  citta: null,
  provincia: null,
  cap: null,
  telefono: null,
  email: null,
  piva: null,
  cf: null,
  referente: null,
  note: null,
  active: 1,
});

beforeEach(() => {
  togliEsecutoreFinto();
  deleteTenantDatabase(T);
  tentativiBloccati.length = 0;
});

after(() => {
  togliEsecutoreFinto();
  togliGuardiaRete();
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

/** Rete /29 (6 IP) con due host noti e accesi. */
function preparaRete(): number {
  const d = getTenantDb(T);
  const id = Number(
    d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.250.0.0/29', 'banco')").run().lastInsertRowid,
  );
  d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, '10.250.0.4', 'online')").run(id);
  d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, '10.250.0.5', 'online')").run(id);
  return id;
}

function host(reteId: number): Array<{ ip: string; status: string }> {
  return getTenantDb(T)
    .prepare("SELECT ip, status FROM hosts WHERE network_id = ? ORDER BY ip")
    .all(reteId) as Array<{ ip: string; status: string }>;
}

async function attendiFine(scanId: string): Promise<{ status: string; error?: string }> {
  const limite = Date.now() + 10_000;
  for (;;) {
    const p = getScanProgress(scanId);
    if (p && p.status !== "running") return { status: p.status, error: p.error };
    if (Date.now() > limite) throw new Error(`scansione ${scanId} ancora in corso dopo 10 s`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const TUTTI = ["10.250.0.1", "10.250.0.2", "10.250.0.3", "10.250.0.4", "10.250.0.5", "10.250.0.6"];

for (const tipo of ["ping", "network_discovery"] as const) {
  test(`discovery «${tipo}» con soli esiti sconosciuti: il giro fallisce e nessun host cambia stato`, async () => {
    const reteId = withTenant(T, preparaRete);
    const prima = host(reteId);
    const { override } = creaEsecutoreFinto({ vivi: [], sconosciuti: TUTTI });
    installaEsecutoreFinto(override);

    const { id } = await withTenant(T, () => discoverNetwork(reteId, tipo));
    const esito = await attendiFine(id);

    assert.deepEqual(tentativiBloccati, []);
    assert.equal(esito.status, "failed");
    assert.match(esito.error ?? "", /sconosciut/i);
    assert.deepEqual(host(reteId), prima);
  });
}

test("discovery «ping» con esiti misti: lo sconosciuto resta com'era, il silenzioso va offline", async () => {
  const reteId = withTenant(T, preparaRete);
  const { override } = creaEsecutoreFinto({ vivi: ["10.250.0.1"], sconosciuti: ["10.250.0.5"] });
  installaEsecutoreFinto(override);

  const { id } = await withTenant(T, () => discoverNetwork(reteId, "ping"));
  const esito = await attendiFine(id);

  assert.deepEqual(tentativiBloccati, []);
  assert.equal(esito.status, "completed");
  assert.deepEqual(host(reteId), [
    { ip: "10.250.0.1", status: "online" },
    { ip: "10.250.0.4", status: "offline" },
    { ip: "10.250.0.5", status: "online" },
  ]);
});

// Controllo degli host noti (job e rotta «run-check»): stesso principio. Un
// esito sconosciuto del ping, se il TCP non recupera l'host, non scrive niente.
test("controllo host noti: lo sconosciuto resta com'era e non lascia storico, il silenzioso va offline", async () => {
  const reteId = withTenant(T, preparaRete);
  getTenantDb(T).prepare("UPDATE hosts SET known_host = 1 WHERE network_id = ?").run(reteId);
  const { override, chiamate } = creaEsecutoreFinto({ vivi: [], sconosciuti: ["10.250.0.5"] });
  installaEsecutoreFinto(override);

  await withTenant(T, () => runKnownHostCheck(null));

  assert.deepEqual(tentativiBloccati, []);
  assert.equal(chiamate.pingHost, 2);
  assert.deepEqual(host(reteId), [
    { ip: "10.250.0.4", status: "offline" },
    { ip: "10.250.0.5", status: "online" },
  ]);
  const storico = getTenantDb(T)
    .prepare("SELECT h.ip FROM status_history s JOIN hosts h ON h.id = s.host_id ORDER BY h.ip")
    .all() as Array<{ ip: string }>;
  assert.deepEqual(storico.map((r) => r.ip), ["10.250.0.4"]);
});
