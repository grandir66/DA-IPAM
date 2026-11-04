/**
 * Il bridge WinRM vero, con `winrm` e `kinit` finti: si contano i logon, non le chiamate.
 *
 * Incidente: revisione del 04/11/2026. Una «prova» WinRM non era un logon solo: kinit, poi NTLM, CredSSP e Basic, cioè fino
 * a quattro logon errati a host sullo stesso account di dominio. Il limite di 3 del motore ne faceva passare dodici.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/winrm-bridge.test.ts
 */
import { spawn } from "node:child_process";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { runWinrmCommand, WinrmError } from "@/lib/devices/winrm-run";
import { creaBridgeFinto, PYTHON, SCRIPT_BRIDGE } from "./support/bridge-winrm-finto";

const salta = PYTHON ? false : "python3 non disponibile";
const banco = creaBridgeFinto();
after(() => banco.togli());

const RICHIESTA = {
  host: "127.0.0.1",
  port: 5985,
  username: "CLIENTE\\scansioni",
  password: "S3greta!",
  command: "hostname",
  usePowershell: false,
  realm: "cliente.local",
};

const nuovi = (prima: number): string[] => banco.logon().slice(prima);

describe("winrm-bridge.py: la catena di serie non cambia", () => {
  it("rifiuto: kinit, NTLM, CredSSP", { skip: salta }, () => {
    const prima = banco.logon().length;
    const r = banco.lancia(RICHIESTA, {});
    assert.equal(r.errorCode, "AUTH_REJECTED");
    assert.deepEqual(nuovi(prima).map((l) => l.split(":").slice(0, 2).join(":")), ["kinit:scansioni@CLIENTE.LOCAL", "logon:ntlm", "logon:credssp"]);
  });

  it("riuscita: l'output arriva", { skip: salta }, () => {
    const r = banco.lancia(RICHIESTA, { ntlm: "ok" });
    assert.equal((r.stdout as string).trim(), "PC-FINTO");
  });
});

describe("winrm-bridge.py: un_solo_logon", () => {
  const casi: Array<[string, string, string]> = [
    ["dominio\\utente", "CLIENTE\\scansioni", "cliente.local"],
    ["upn", "scansioni@cliente.local", ""],
    ["utente nudo col realm configurato", "scansioni", "cliente.local"],
  ];
  for (const [nome, username, realm] of casi) {
    it(`${nome}: un logon solo, NTLM, niente kinit`, { skip: salta }, () => {
      const prima = banco.logon().length;
      const r = banco.lancia({ ...RICHIESTA, username, realm, un_solo_logon: true }, { kerberos: "rifiuta", ntlm: "rifiuta", credssp: "ok", basic: "ok" }, { KINIT_FINTO_ESITO: "0" });
      assert.equal(r.errorCode, "AUTH_REJECTED");
      assert.deepEqual(nuovi(prima), [`logon:ntlm:${username}`]);
    });
  }

  for (const forzato of ["kerberos", "basic", "credssp"]) {
    it(`WINRM_TRANSPORT=${forzato} sul server non aggiunge logon`, { skip: salta }, () => {
      const prima = banco.logon().length;
      banco.lancia({ ...RICHIESTA, un_solo_logon: true }, {}, { WINRM_TRANSPORT: forzato, KINIT_FINTO_ESITO: "0" });
      assert.deepEqual(nuovi(prima), [`logon:ntlm:${RICHIESTA.username}`]);
    });
  }

  it("riuscita su NTLM: stesso output, un logon", { skip: salta }, () => {
    const prima = banco.logon().length;
    const r = banco.lancia({ ...RICHIESTA, un_solo_logon: true }, { ntlm: "ok" });
    assert.equal((r.stdout as string).trim(), "PC-FINTO");
    assert.equal(r.transport, "ntlm");
    assert.equal(nuovi(prima).length, 1);
  });

  it("solo col vero: una stringa non accende la modalità", { skip: salta }, () => {
    const prima = banco.logon().length;
    banco.lancia({ ...RICHIESTA, un_solo_logon: "no" }, {});
    assert.ok(nuovi(prima).length > 1);
  });
});

describe("winrm-bridge.py: dichiara il rifiuto", () => {
  it("NTLM rifiutato e l'ultimo errore è un timeout: errore di timeout, ma rifiutato", { skip: salta }, () => {
    const r = banco.lancia(RICHIESTA, { ntlm: "rifiuta", credssp: "timeout" });
    assert.equal(r.errorCode, "TCP_TIMEOUT");
    assert.equal(r.rifiutato, true);
  });

  it("NTLM rifiutato, CredSSP assente, Basic in timeout: rifiutato", { skip: salta }, () => {
    const r = banco.lancia(RICHIESTA, { ntlm: "rifiuta", credssp: "senza_credssp", basic: "timeout" });
    assert.equal(r.rifiutato, true);
  });

  it("solo timeout: nessun rifiuto", { skip: salta }, () => {
    const r = banco.lancia(RICHIESTA, { ntlm: "timeout" });
    assert.equal(r.rifiutato, false);
  });

  it("trasporto forzato e rifiutato: rifiutato", { skip: salta }, () => {
    const r = banco.lancia(RICHIESTA, { ntlm: "rifiuta" }, { WINRM_TRANSPORT: "ntlm" });
    assert.equal(r.rifiutato, true);
  });
});

describe("runWinrmCommand col bridge vero", () => {
  const lancia = (condotte: Parameters<typeof banco.dipendenze>[0], unSoloLogon?: boolean) =>
    runWinrmCommand("127.0.0.1", 5985, "CLIENTE\\scansioni", "S3greta!", "hostname", false, "cliente.local", unSoloLogon ? { timeoutMs: 15_000, unSoloLogon } : 15_000, banco.dipendenze(condotte));

  it("il rifiuto dichiarato arriva sull'errore", { skip: salta }, async () => {
    await assert.rejects(lancia({ ntlm: "rifiuta", credssp: "timeout" }), (e: unknown) => {
      assert.ok(e instanceof WinrmError);
      assert.equal(e.code, "TCP_TIMEOUT");
      assert.equal(e.rifiutato, true);
      return true;
    });
  });

  it("senza rifiuto l'errore non lo dichiara", { skip: salta }, async () => {
    await assert.rejects(lancia({ ntlm: "timeout" }), (e: unknown) => e instanceof WinrmError && e.rifiutato === false);
  });

  it("un errore del bridge non viene dal controllo TCP, nemmeno se è un timeout", { skip: salta }, async () => {
    await assert.rejects(lancia({ ntlm: "timeout" }), (e: unknown) => e instanceof WinrmError && e.code === "TCP_TIMEOUT" && e.primaDelBridge === false);
  });

  it("chi non chiede un solo logon ha la catena; chi lo chiede ne fa uno", { skip: salta }, async () => {
    let prima = banco.logon().length;
    await assert.rejects(lancia({}));
    assert.ok(nuovi(prima).length > 1);
    prima = banco.logon().length;
    await assert.rejects(lancia({}, true));
    assert.equal(nuovi(prima).length, 1);
  });

  it("il controllo TCP fatto prima del bridge si dichiara, e nessun logon", async () => {
    const prima = banco.logon().length;
    const deps = banco.dipendenze({});
    for (const summary of ["closed", "timeout", "mixed"] as const) {
      deps.checkWinrmReachability = async () => ({ reachable: false, summary, results: [] });
      await assert.rejects(runWinrmCommand("127.0.0.1", 5985, "u", "p", "hostname", false, "", 1000, deps), (e: unknown) => e instanceof WinrmError && e.primaDelBridge === true);
    }
    assert.equal(nuovi(prima).length, 0);
  });
});

describe("winrm-bridge.py: SIGTERM col processo vero", () => {
  it("con le chiusure appese esce da solo entro la tolleranza, non dopo i 120 s di lettura", { skip: salta, timeout: 20_000 }, async () => {
    const figlio = spawn(PYTHON as string, [SCRIPT_BRIDGE], { env: banco.ambiente({ ntlm: "appeso" }), stdio: ["pipe", "ignore", "ignore"] });
    const uscito = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      figlio.once("exit", (code, signal) => resolve({ code, signal }));
    });
    figlio.stdin.end(JSON.stringify({ ...RICHIESTA, un_solo_logon: true }));

    while (!banco.registro().includes("comando-appeso")) await new Promise((r) => setTimeout(r, 20));
    const inizio = Date.now();
    figlio.kill("SIGTERM");

    const vivo = setTimeout(() => figlio.kill("SIGKILL"), 15_000);
    const esito = await uscito;
    clearTimeout(vivo);
    assert.ok(Date.now() - inizio < 8_000, `uscito dopo ${Date.now() - inizio} ms: ${JSON.stringify(esito)}`);
    assert.notEqual(esito.signal, "SIGKILL", "è servito il colpo da fuori");
  });
});
