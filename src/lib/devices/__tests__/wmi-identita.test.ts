// Prova leggera di identità WMI (piano accesso Windows, Task 1). Il motore che prova WinRM e WMI da solo durante la
// scansione ha bisogno di una domanda piccola — «chi sei?» — con un tetto di 20 secondi: una macchina che non risponde
// non deve fermare il giro. Qui `execFile` e il controllo della 135 sono finti: non parte nessun processo Python.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExecFileException } from "node:child_process";
import {
  WmiError,
  eseguiBridge,
  runWmiIdentita,
  type DipendenzeWmi,
  type OpzioniExecFile,
} from "@/lib/devices/wmi-run";
import type { TcpProbeResult } from "@/lib/devices/tcp-precheck";

type Chiamata = { file: string; args: readonly string[]; opts: OpzioniExecFile; stdin: string[]; chiuso: boolean };

function dipendenze(
  risposta: (cb: (e: ExecFileException | null, out: string, err: string) => void) => void,
  porta135: TcpProbeResult["state"] = "open",
) {
  const chiamate: Chiamata[] = [];
  const porteProvate: number[] = [];
  const deps: DipendenzeWmi = {
    execFile(file, args, opts, cb) {
      const c: Chiamata = { file, args, opts, stdin: [], chiuso: false };
      chiamate.push(c);
      setImmediate(() => risposta(cb));
      return {
        stdin: {
          write(chunk: string) { c.stdin.push(chunk); return true; },
          end() { c.chiuso = true; },
        },
      };
    },
    async probeTcpPort(_host, port) {
      porteProvate.push(port);
      return { state: porta135, port, rttMs: 1 } as TcpProbeResult;
    },
    trovaPython: () => "/finto/python3",
  };
  return { deps, chiamate, porteProvate };
}

const PASSWORD = "S3greta!non-in-argomento";

test("identità: hostname e dominio dal bridge, password solo su stdin, tetto 20 s, solo_identita nell'input", async () => {
  const { deps, chiamate, porteProvate } = dipendenze((cb) =>
    cb(null, JSON.stringify({ data: { hostname: "PC-CONTAB", domain: "DOMARC", _probe_transport: "wmi/dcom" }, transport: "wmi/dcom" }), ""),
  );
  const id = await runWmiIdentita("10.0.0.5", "DOMARC\\scansioni", PASSWORD, deps);
  assert.deepEqual(id, { hostname: "PC-CONTAB", dominio: "DOMARC" });
  assert.deepEqual(porteProvate, [135]);
  assert.equal(chiamate.length, 1);
  const c = chiamate[0];
  assert.equal(c.opts.timeout, 20_000);
  assert.ok(!c.args.join(" ").includes(PASSWORD), "la password non deve stare negli argomenti");
  assert.equal(c.chiuso, true);
  const input = JSON.parse(c.stdin.join("")) as Record<string, unknown>;
  assert.equal(input.password, PASSWORD);
  assert.equal(input.host, "10.0.0.5");
  assert.equal(input.solo_identita, true);
});

test("identità: dominio assente o vuoto → null (macchina fuori dominio)", async () => {
  const { deps } = dipendenze((cb) => cb(null, JSON.stringify({ data: { hostname: "PC-SOLO", domain: "" } }), ""));
  assert.deepEqual(await runWmiIdentita("10.0.0.6", "admin", PASSWORD, deps), { hostname: "PC-SOLO", dominio: null });
});

test("identità: AUTH_REJECTED dal bridge diventa WmiError con quel codice, senza la password nel messaggio", async () => {
  const { deps } = dipendenze((cb) =>
    cb(null, JSON.stringify({ error: "WMI access denied: rpc_s_access_denied", errorCode: "AUTH_REJECTED", transport: "wmi/dcom" }), ""),
  );
  await assert.rejects(runWmiIdentita("10.0.0.5", "admin", PASSWORD, deps), (e: unknown) => {
    assert.ok(e instanceof WmiError);
    assert.equal(e.code, "AUTH_REJECTED");
    assert.ok(!e.message.includes(PASSWORD));
    return true;
  });
});

test("identità: porta 135 chiusa → TCP_CLOSED senza lanciare il bridge", async () => {
  const { deps, chiamate } = dipendenze((cb) => cb(null, "{}", ""), "refused");
  await assert.rejects(runWmiIdentita("10.0.0.7", "admin", PASSWORD, deps), (e: unknown) => e instanceof WmiError && e.code === "TCP_CLOSED");
  assert.equal(chiamate.length, 0);
});

test("identità: porta 135 che non risponde → TCP_TIMEOUT senza lanciare il bridge", async () => {
  const { deps, chiamate } = dipendenze((cb) => cb(null, "{}", ""), "timeout");
  await assert.rejects(runWmiIdentita("10.0.0.7", "admin", PASSWORD, deps), (e: unknown) => e instanceof WmiError && e.code === "TCP_TIMEOUT");
  assert.equal(chiamate.length, 0);
});

test("identità: tetto superato (processo ucciso da execFile) → BRIDGE_TIMEOUT che nomina i 20 s", async () => {
  const { deps } = dipendenze((cb) => {
    const e: ExecFileException = Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" as NodeJS.Signals });
    cb(e, "", "");
  });
  await assert.rejects(runWmiIdentita("10.0.0.8", "admin", PASSWORD, deps), (e: unknown) => {
    assert.ok(e instanceof WmiError);
    assert.equal(e.code, "BRIDGE_TIMEOUT");
    assert.ok(e.message.includes("20s"));
    return true;
  });
});

test("identità: risposta senza hostname → errore, non un'identità vuota", async () => {
  const { deps } = dipendenze((cb) => cb(null, JSON.stringify({ data: {} }), ""));
  await assert.rejects(runWmiIdentita("10.0.0.9", "admin", PASSWORD, deps), (e: unknown) => e instanceof WmiError && e.code === "UNKNOWN");
});

test("eseguiBridge: il tetto è quello passato (la prova completa resta a 90 s)", async () => {
  const { deps, chiamate } = dipendenze((cb) => cb(null, JSON.stringify({ data: { a: 1 } }), ""));
  const dati = await eseguiBridge({ host: "h", username: "u", password: PASSWORD }, 90_000, deps);
  assert.deepEqual(dati, { a: 1 });
  assert.equal(chiamate[0].opts.timeout, 90_000);
});
