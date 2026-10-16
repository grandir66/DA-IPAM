// I53 (spec §13.5.1): il tempo massimo di oggi vale solo per aprire la connessione (`readyTimeout`), e `sshExec` aspetta
// che il canale si chiuda: un `monitor` senza `once`, una domanda interattiva o un apparato bloccato fermavano il giro per
// sempre, e con lui gli apparati dopo (si leggono uno alla volta). `execConTempo` chiude il canale allo scadere e dà un
// errore col suo codice, che il resoconto nomina da solo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Client as SshClient } from "ssh2";
import { CODICE_TEMPO_SCADUTO, execConTempo } from "@/lib/devices/ssh-transport";
import { codiceErrore } from "@/lib/devices/mikrotik-porte";

function flusso() {
  const s = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), chiuso: 0, close() { s.chiuso++; } });
  return s;
}
function connFinta(comportamento: (s: ReturnType<typeof flusso>) => void, errore?: Error) {
  const s = flusso();
  const conn = { exec(_cmd: string, cb: (err: Error | undefined, stream: unknown) => void) { setImmediate(() => { if (errore) cb(errore, undefined); else { cb(undefined, s); comportamento(s); } }); } };
  return { conn: conn as unknown as Pick<SshClient, "exec">, s };
}

test("un comando che non chiude il canale: errore TEMPO_SCADUTO allo scadere, e il canale si chiude", async () => {
  const { conn, s } = connFinta(() => { /* non risponde mai */ });
  const t0 = Date.now();
  await assert.rejects(execConTempo(conn, "/interface bridge monitor [find]", 40), (e: unknown) => codiceErrore(e) === CODICE_TEMPO_SCADUTO);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(s.chiuso, 1);
});

test("un comando che risponde: stdout, stderr e codice d'uscita, e il tempo non scade dopo", async () => {
  const { conn } = connFinta((s) => { s.emit("data", Buffer.from("riga\r\n")); s.stderr.emit("data", Buffer.from("")); s.emit("close", 0); });
  assert.deepEqual(await execConTempo(conn, "/interface bridge print terse", 1000), { stdout: "riga\r\n", stderr: "", code: 0 });
});

test("il canale rifiutato è un errore, non un'uscita vuota", async () => {
  const { conn } = connFinta(() => undefined, Object.assign(new Error("Channel open failure"), { code: "CHANNEL_OPEN_FAILURE" }));
  await assert.rejects(execConTempo(conn, "x", 1000), (e: unknown) => codiceErrore(e) === "CHANNEL_OPEN_FAILURE");
});
