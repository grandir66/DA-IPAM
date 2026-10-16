/**
 * Una sessione SNMP sola, v3 compresa (tappa 2 credenziali, T4, 15/10).
 *
 * INCIDENTE: cinque punti aprivano la sessione v3 da soli, tutti con
 * authNoPriv e MD5 fissi e la chiave presa da `encrypted_password`. Una v3
 * scritta dalla pagina (authPriv, SHA, AES) non entrava mai: l'apparato
 * taceva, o si ripiegava sulla community e su «public». Qui la sessione v3 la
 * apre solo `apriSessioneSnmp`, con livello, protocolli e chiavi della voce,
 * e un'opzione che Node 22 non sa fare (DES) si rifiuta prima della rete.
 *
 * Run: node --import tsx --test src/lib/protocols/__tests__/snmp-sessione-v3.test.ts
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as snmp from "net-snmp";
import { apriSessioneSnmp, etichettaPrivacyV3, SNMP_V3_PRIV_PROTOCOLS, type CredenzialeSnmp } from "@/lib/protocols/snmp-sessione";
import type { SnmpV3CredentialRecord } from "@/lib/protocols/snmpv3";
import { avviaAgenteV3, utenteShaAes, OID_SYSDESCR, type AgenteV3 } from "./support/agente-snmp-v3";

const aperti: AgenteV3[] = [];
after(async () => {
  for (const a of aperti) await a.chiudi();
});

async function agente(utente = utenteShaAes()): Promise<AgenteV3> {
  const a = await avviaAgenteV3({ utente, sysDescr: "Switch finto v3" });
  aperti.push(a);
  return a;
}

function v3(parziale: Partial<SnmpV3CredentialRecord> = {}): CredenzialeSnmp {
  return {
    forma: "v3",
    record: {
      username: "monitor",
      securityLevel: "authPriv",
      authProtocol: "SHA",
      authKey: "chiave-auth-123",
      privProtocol: "AES",
      privKey: "chiave-priv-456",
      ...parziale,
    },
  };
}

/** Un GET di sysDescr, sessione chiusa una volta sola. */
function sysDescr(session: snmp.Session): Promise<{ ok: true; valore: string } | { ok: false; errore: string }> {
  return new Promise((resolve) => {
    session.get([OID_SYSDESCR], (err, varbinds) => {
      try { session.close(); } catch { /* già chiusa */ }
      if (err) return resolve({ ok: false, errore: err.message });
      const vb = varbinds[0];
      if (!vb || snmp.isVarbindError(vb)) return resolve({ ok: false, errore: "varbind in errore" });
      resolve({ ok: true, valore: String(vb.value) });
    });
  });
}

test("v3 authPriv SHA/AES dal record: l'agente risponde", async () => {
  const a = await agente();
  const aperta = apriSessioneSnmp(snmp, "127.0.0.1", v3(), { port: a.porta, timeout: 1500, versione: null });
  assert.equal(aperta.ok, true, aperta.ok ? "" : aperta.motivo);
  if (!aperta.ok) return;
  assert.deepEqual(await sysDescr(aperta.session), { ok: true, valore: "Switch finto v3" });
  assert.deepEqual(a.errori, []);
});

test("v3 con la chiave d'autenticazione sbagliata: la sessione si apre, il GET fallisce", async () => {
  const a = await agente();
  const aperta = apriSessioneSnmp(snmp, "127.0.0.1", v3({ authKey: "chiave-sbagliata" }), { port: a.porta, timeout: 500, retries: 0, versione: null });
  assert.equal(aperta.ok, true);
  if (!aperta.ok) return;
  const esito = await sysDescr(aperta.session);
  assert.equal(esito.ok, false);
  assert.ok(a.errori.some((e) => /digest/i.test(e)), "l'agente ha scartato il messaggio per il digest");
});

test("AES256 è Blumenthal, AES256C è Reeder («AES-256 (Cisco)»): ognuno parla col suo agente", async () => {
  for (const [codice, privProtocol] of [["AES256", snmp.PrivProtocols.aes256b], ["AES256C", snmp.PrivProtocols.aes256r]] as const) {
    const a = await agente({ ...utenteShaAes(), privProtocol });
    const aperta = apriSessioneSnmp(snmp, "127.0.0.1", v3({ privProtocol: codice }), { port: a.porta, timeout: 1500, versione: null });
    assert.equal(aperta.ok, true, aperta.ok ? "" : aperta.motivo);
    if (!aperta.ok) return;
    assert.deepEqual(await sysDescr(aperta.session), { ok: true, valore: "Switch finto v3" }, codice);
  }
  assert.ok((SNMP_V3_PRIV_PROTOCOLS as readonly string[]).includes("AES256C"));
  assert.equal(etichettaPrivacyV3("AES256C"), "AES-256 (Cisco)");
  assert.equal(etichettaPrivacyV3("AES"), "AES");
});

test("DES si rifiuta prima della rete: Node 22 non lo sa fare", () => {
  let aperte = 0;
  const finto = { ...snmp, createV3Session: () => { aperte++; return {} as snmp.Session; } } as unknown as typeof snmp;
  const aperta = apriSessioneSnmp(finto, "192.0.2.1", v3({ privProtocol: "DES" }), { port: 161, timeout: 500, versione: null });
  assert.deepEqual(aperta, { ok: false, motivo: "DES non è supportato da Node 22: usa AES" });
  assert.equal(aperte, 0, "nessuna sessione aperta");
});

test("una v3 incompleta si rifiuta col motivo e senza segreti", () => {
  const aperta = apriSessioneSnmp(snmp, "192.0.2.1", v3({ privKey: null }), { port: 161, timeout: 500, versione: null });
  assert.equal(aperta.ok, false);
  if (aperta.ok) return;
  assert.match(aperta.motivo, /chiave di privacy/i);
  assert.ok(!aperta.motivo.includes("chiave-auth-123"));
});

test("community: la versione è obbligatoria, e passa ad apriSessioneCommunity", () => {
  const viste: Array<Record<string, unknown>> = [];
  const finto = {
    ...snmp,
    createSession: (_h: string, _c: string, o?: Record<string, unknown>) => {
      viste.push(o ?? {});
      return {} as snmp.Session;
    },
  } as unknown as typeof snmp;
  const senza = apriSessioneSnmp(finto, "192.0.2.1", { forma: "community", community: "x" }, { port: 161, timeout: 500, versione: null });
  assert.equal(senza.ok, false);
  const con = apriSessioneSnmp(finto, "192.0.2.1", { forma: "community", community: "x" }, { port: 1161, timeout: 900, versione: "1" });
  assert.equal(con.ok, true);
  assert.deepEqual(viste, [{ port: 1161, timeout: 900, version: snmp.Version1 }]);
});
