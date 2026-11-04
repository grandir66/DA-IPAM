/**
 * Tetto sulla prova WinRM (piano 2026-11-04 accesso Windows): una macchina non può fermare la scansione.
 * `runWinrmCommand` riceve `timeoutMs` in fondo; il motore passerà 20000 nel Task 5, chi non lo passa resta a 120 s.
 * Il superamento è sempre `BRIDGE_TIMEOUT`, anche col bridge ucciso a metà scrittura: `UNKNOWN` conterebbe sul limite di
 * 3 come un logon rifiutato, mentre qui nessuno ha rifiutato niente.
 *
 * Il `execFile` finto dice che cosa riceve il bridge; le due prove col processo vero danno l'errore nella forma vera.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/winrm-tetto.test.ts
 */
import { execFile } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runWinrmCommand, WinrmError, type DipendenzeWinrm } from "@/lib/devices/winrm-run";

const PASSWORD = "segreto-di-prova";

/** Porte WinRM aperte, nessuna rete. */
const raggiungibile: DipendenzeWinrm["checkWinrmReachability"] = async () => ({ reachable: true, summary: "open", results: [] });

function finti(risposta: (cb: Parameters<DipendenzeWinrm["execFile"]>[3]) => void) {
  const chiamate: Array<{ args: readonly string[]; timeout: number | undefined; stdin: string[] }> = [];
  const deps: DipendenzeWinrm = {
    checkWinrmReachability: raggiungibile,
    trovaPython: () => "/finto/python3",
    execFile(_file, args, opts, cb) {
      const c = { args, timeout: opts.timeout, stdin: [] as string[] };
      chiamate.push(c);
      setImmediate(() => risposta(cb));
      return { stdin: { write: (s: string) => c.stdin.push(s), end: () => {} } };
    },
  };
  return { deps, chiamate };
}

const riuscita = (cb: Parameters<DipendenzeWinrm["execFile"]>[3]) => cb(null, JSON.stringify({ stdout: "PC-PROVA" }), "");

const prova = (deps: DipendenzeWinrm, timeoutMs?: number) =>
  runWinrmCommand("127.0.0.1", 5985, "CLIENTE\\scansioni", PASSWORD, "hostname", false, "cliente.local", timeoutMs, deps);

const codice = (atteso: string) => (e: unknown) => e instanceof WinrmError && e.code === atteso;

/** Il bridge sostituito da un processo vero, che execFile uccide allo scadere del tetto. */
function processoVero(comando: string): DipendenzeWinrm {
  return {
    checkWinrmReachability: raggiungibile,
    trovaPython: () => "/bin/sh",
    execFile: (_file, _args, opts, cb) => execFile("/bin/sh", ["-c", comando], opts, cb),
  };
}

describe("runWinrmCommand: il tetto", () => {
  it("chi lo passa lo dà al bridge", async () => {
    const { deps, chiamate } = finti(riuscita);
    assert.equal(await prova(deps, 20_000), "PC-PROVA");
    assert.equal(chiamate[0].timeout, 20_000);
  });

  it("chi non lo passa resta a 120 secondi", async () => {
    const { deps, chiamate } = finti(riuscita);
    await prova(deps);
    assert.equal(chiamate[0].timeout, 120_000);
  });

  it("la password resta su stdin, mai negli argomenti", async () => {
    const { deps, chiamate } = finti(riuscita);
    await prova(deps, 20_000);
    assert.ok(!chiamate[0].args.join(" ").includes(PASSWORD));
    assert.ok(chiamate[0].stdin.join("").includes(PASSWORD));
  });

  it("superato, col processo vero: BRIDGE_TIMEOUT coi secondi del tetto", async () => {
    await assert.rejects(prova(processoVero("exec sleep 5"), 2000), (e: unknown) => codice("BRIDGE_TIMEOUT")(e) && (e as Error).message.includes("2s"));
  });

  it("superato col bridge ucciso a metà scrittura: BRIDGE_TIMEOUT, non UNKNOWN", async () => {
    await assert.rejects(prova(processoVero(`printf '{"stdout": "PC-'; exec sleep 5`), 300), codice("BRIDGE_TIMEOUT"));
  });

  it("un bridge caduto da solo a metà scrittura resta UNKNOWN: il tetto non c'entra", async () => {
    await assert.rejects(prova(processoVero(`printf '{"stdout": "PC-'; exit 1`), 5000), codice("UNKNOWN"));
  });

  it("porte chiuse: nessun bridge, e il tetto non cambia il codice", async () => {
    const { deps, chiamate } = finti(riuscita);
    deps.checkWinrmReachability = async () => ({ reachable: false, summary: "closed", results: [] });
    await assert.rejects(prova(deps, 20_000), codice("TCP_CLOSED"));
    assert.equal(chiamate.length, 0);
  });
});
