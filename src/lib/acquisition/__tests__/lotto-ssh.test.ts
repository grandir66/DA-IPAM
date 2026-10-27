/**
 * Il lettore SSH a lotti (collaudo `da-ftp`, 22/10): un comando che fallisce non ferma gli altri; si ferma solo per un
 * guasto vero della connessione.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { leggiLotto } from "../transports";
import type { ReadResult } from "../schema";

const ok = (data: string): ReadResult<string> => ({ status: "ok", data, warnings: [] });
const risposte = (m: Record<string, ReadResult<string>>) => async (c: string) => m[c];
const lontano = () => Date.now() + 60_000;

test("lotto: comando con uscita ≠ 0, assente, negato o senza stato di uscita non ferma i seguenti", async () => {
    const r = await leggiLotto(["uname", "timedatectl", "lsblk", "dpkg", "systemctl"], risposte({
        uname: ok("Linux"),
        timedatectl: { status: "error", data: "", warnings: ["SSH_COMMAND_FAILED"] },
        lsblk: { status: "error", data: "", warnings: ["SSH_PERMISSION_DENIED"] },
        dpkg: { status: "partial", data: "x", warnings: ["SSH_EXIT_STATUS_MISSING"] },
        systemctl: ok("ssh.service"),
    }), lontano());
    assert.equal(r.systemctl.status, "ok");
    assert.equal(Object.values(r).filter(v => v.warnings.includes("SSH_BATCH_ABORTED")).length, 0);
});

test("lotto: un solo comando scaduto non ferma il lotto, due di fila sì", async () => {
    const scade: ReadResult<string> = { status: "error", data: "", warnings: ["SSH_EXEC_TIMEOUT"] };
    const uno = await leggiLotto(["a", "b", "c"], risposte({ a: scade, b: ok("b"), c: ok("c") }), lontano());
    assert.equal(uno.c.status, "ok");
    const due = await leggiLotto(["a", "b", "c"], risposte({ a: scade, b: scade, c: ok("c") }), lontano());
    assert.deepEqual(due.c.warnings, ["SSH_BATCH_ABORTED"]);
});

test("lotto: canale caduto o connessione fallita ferma il resto", async () => {
    for (const w of ["SSH_CHANNEL_ERROR", "SSH_CONNECT_FAILED"]) {
        const r = await leggiLotto(["a", "b"], risposte({ a: { status: "error", data: "", warnings: [w] }, b: ok("b") }), lontano());
        assert.deepEqual(r.b.warnings, ["SSH_BATCH_ABORTED"], w);
    }
});
