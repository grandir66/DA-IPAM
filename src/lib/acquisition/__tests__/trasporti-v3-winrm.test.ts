import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { acquisitionInputSchema } from "../schema";
import { createTransports, createWinrmReader } from "../transports";
import { redactSnapshot } from "../redact";
import { WinrmError } from "../../devices/winrm-run";

const v3 = { version: "3", username: "monitor", level: "authPriv", authProtocol: "SHA", authKey: "AUTH-KEY-LAB-1", privProtocol: "AES", privKey: "PRIV-KEY-LAB-1" } as const;
const base = { collector: "hp-procurve", host: "192.0.2.1" } as const;

// net-snmp finto: registra come si apre la sessione, risponde a get() con una riga.
function fakeSnmp() {
    const calls: { kind: string; host: string; arg: unknown }[] = [];
    const session = Object.assign(new EventEmitter(), {
        get: (oids: string[], cb: (e: Error | null, v: { oid: string; value: string }[]) => void) => cb(null, oids.map(oid => ({ oid, value: "lab" }))),
        subtree: () => undefined,
        close: () => undefined,
    });
    const mod = {
        Version1: 0, Version2c: 1,
        SecurityLevel: { noAuthNoPriv: 1, authNoPriv: 2, authPriv: 3 },
        AuthProtocols: { md5: "md5", sha: "sha", sha224: "sha224", sha256: "sha256", sha384: "sha384", sha512: "sha512" },
        PrivProtocols: { des: "des", aes: "aes", aes256b: "aes256b", aes256r: "aes256r" },
        createSession: (host: string, community: string) => { calls.push({ kind: "v2", host, arg: community }); return session; },
        createV3Session: (host: string, user: unknown) => { calls.push({ kind: "v3", host, arg: user }); return session; },
        isVarbindError: () => false,
    };
    return { mod, calls };
}

test("input: SNMPv3 accettato per i collector a SNMP, community invariata, v3 incompleto rifiutato", () => {
    assert.equal(acquisitionInputSchema.safeParse({ ...base, snmp: v3 }).success, true);
    assert.equal(acquisitionInputSchema.safeParse({ ...base, snmp: { community: "lab", version: "2c" } }).success, true);
    assert.equal(acquisitionInputSchema.safeParse({ ...base, snmp: { version: "3", username: "monitor" } }).success, false);
    assert.equal(acquisitionInputSchema.safeParse({ ...base, snmp: { ...v3, community: "lab" } }).success, false);
});

test("SNMPv3: la sessione si apre solo da apriSessioneSnmp con utente, protocolli e chiavi; mai la community", async () => {
    const f = fakeSnmp();
    const t = createTransports(acquisitionInputSchema.parse({ ...base, snmp: v3 }), { snmp: f.mod as never });
    const r = await t.get(["1.3.6.1.2.1.1.1.0"]);
    assert.equal(r.status, "ok");
    assert.deepEqual(f.calls.map(c => c.kind), ["v3"]);
    assert.deepEqual(f.calls[0].arg, { name: "monitor", level: 3, authProtocol: "sha", authKey: "AUTH-KEY-LAB-1", privProtocol: "aes", privKey: "PRIV-KEY-LAB-1" });
});

test("SNMPv3 incoerente (authPriv senza chiave di privacy): errore prima della rete, senza segreti nei messaggi", async () => {
    const f = fakeSnmp();
    const t = createTransports(acquisitionInputSchema.parse({ ...base, snmp: { ...v3, privKey: undefined } }), { snmp: f.mod as never });
    const r = await t.get(["1.3.6.1.2.1.1.1.0"]);
    assert.equal(r.status, "error");
    assert.deepEqual(r.warnings, ["SNMP_V3_OPTIONS_INVALID"]);
    assert.equal(f.calls.length, 0);
    assert.equal(JSON.stringify(r).includes("AUTH-KEY-LAB-1"), false);
});

test("redazione: le chiavi v3 non restano in nessun testo libero", () => {
    const input = acquisitionInputSchema.parse({ ...base, snmp: v3 });
    const snap = { schema_version: "1.0", collector: "hp-procurve", collector_version: "1.0.0", target: "x", collected_at: new Date().toISOString(), duration_ms: 1, status: "ok", identity: { status: "ok", warnings: [], sources: [], collected_at: "", data: { hostname: "eco AUTH-KEY-LAB-1 e PRIV-KEY-LAB-1" } } } as unknown as Parameters<typeof redactSnapshot>[0];
    const out = JSON.stringify(redactSnapshot(snap, input));
    assert.equal(out.includes("AUTH-KEY-LAB-1"), false);
    assert.equal(out.includes("PRIV-KEY-LAB-1"), false);
});

const winrmInput = acquisitionInputSchema.parse({ ...base, ssh: { username: "u", password: "p" } });
const winCred = { username: "DOM\\lettore", password: "WINRM-SECRET-LAB", port: 5985, realm: "lab.example" };
const SCRIPT = { "os-info": "Get-CimInstance Win32_OperatingSystem | ConvertTo-Json" } as const;

test("WinRM: solo script in allowlist; un id sconosciuto non raggiunge il runner", async () => {
    const calls: string[] = [];
    const read = createWinrmReader({ host: "192.0.2.1", winrm: winCred, limits: winrmInput.limits }, SCRIPT, async (_h, _p, _u, _pw, cmd) => { calls.push(cmd); return "{}"; });
    await assert.rejects(read(["Remove-Item C:\\"]), /COMMAND_NOT_ALLOWED/);
    assert.equal(calls.length, 0);
    const ok = await read(["os-info"]);
    assert.equal(ok["os-info"].status, "ok");
    assert.deepEqual(calls, [SCRIPT["os-info"]]);
});

test("WinRM: errore del bridge → stato error con solo il codice, nessun messaggio grezzo né segreto", async () => {
    const read = createWinrmReader({ host: "192.0.2.1", winrm: winCred, limits: winrmInput.limits }, SCRIPT, async () => {
        throw new WinrmError({ code: "AUTH_REJECTED", message: "rifiutato per DOM\\lettore con WINRM-SECRET-LAB", original: "WINRM-SECRET-LAB" });
    });
    const r = await read(["os-info"]);
    assert.equal(r["os-info"].status, "error");
    assert.deepEqual(r["os-info"].warnings, ["WINRM_AUTH_REJECTED"]);
    assert.equal(JSON.stringify(r).includes("WINRM-SECRET-LAB"), false);
});

test("WinRM: eccezione generica, uscita oltre il limite e tempo scaduto restano errori espliciti", async () => {
    const lim = { ...winrmInput.limits, max_output_bytes: 4096 };
    const boom = createWinrmReader({ host: "192.0.2.1", winrm: winCred, limits: lim }, SCRIPT, async () => { throw new Error("segreto WINRM-SECRET-LAB"); });
    assert.deepEqual((await boom(["os-info"]))["os-info"].warnings, ["WINRM_FAILED"]);
    const big = createWinrmReader({ host: "192.0.2.1", winrm: winCred, limits: lim }, SCRIPT, async () => "x".repeat(5000));
    const rb = await big(["os-info"]);
    assert.equal(rb["os-info"].status, "error");
    assert.deepEqual(rb["os-info"].warnings, ["OUTPUT_LIMIT"]);
    assert.equal(rb["os-info"].data, "");
    const slow = createWinrmReader({ host: "192.0.2.1", winrm: winCred, limits: { ...lim, total_timeout_ms: 5000 } }, SCRIPT, () => new Promise<string>(() => undefined), 30);
    assert.deepEqual((await slow(["os-info"]))["os-info"].warnings, ["WINRM_TIMEOUT"]);
});

test("WinRM: dopo un errore di connessione/autenticazione gli script successivi non partono", async () => {
    let n = 0;
    const read = createWinrmReader({ host: "192.0.2.1", winrm: winCred, limits: winrmInput.limits }, { a: "A", b: "B" }, async () => { n++; throw new WinrmError({ code: "AUTH_REJECTED", message: "x" }); });
    const r = await read(["a", "b"]);
    assert.equal(n, 1);
    assert.deepEqual(r.b.warnings, ["WINRM_BATCH_ABORTED"]);
});
