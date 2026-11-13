// Dettagli veri degli alert: i tre casi ripetuti di DTS del 13/11/2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dettagliAlert } from "../wazuh-dettagli";

const mappa = (doc: unknown) => new Map(dettagliAlert(doc).map((d) => [d.nome, d.valore]));

test("4738: chi ha fatto la modifica e che cosa è cambiato, senza i campi vuoti", () => {
  const m = mappa({ data: { win: { system: { eventID: "4738", computer: "SRV-MES.dts.local" }, eventdata: {
    subjectUserName: "SRV-MES$", subjectDomainName: "DTS", targetUserName: "Administrator",
    passwordLastSet: "13/11/2026 02:31:47", displayName: "-", scriptPath: "%%1793", oldUacValue: "0x10", newUacValue: "0x210",
  } } } });
  assert.equal(m.get("Fatto da"), "SRV-MES$");
  assert.equal(m.get("Account toccato"), "Administrator");
  assert.equal(m.get("Password impostata il"), "13/11/2026 02:31:47");
  assert.equal(m.get("Opzioni account dopo"), "0x210");
  assert.equal(m.has("Nome visualizzato"), false);
  assert.equal(m.has("scriptPath"), false);
  assert.equal(m.get("Computer"), "SRV-MES.dts.local");
});

test("Microsoft 365: esito, codice d'errore e programma del client", () => {
  const m = mappa({ data: { office365: { Operation: "UserLoginFailed", ResultStatus: "Failed", ErrorNumber: "50126", ClientIP: "38.114.120.157",
    ExtendedProperties: [{ Name: "UserAgent", Value: "BAV2ROPC" }, { Name: "ResultStatusDetail", Value: "Redirect" }] } } });
  assert.equal(m.get("Codice d'errore"), "50126");
  assert.equal(m.get("Programma del client"), "BAV2ROPC");
  assert.equal(m.get("Dettaglio dell'esito"), "Redirect");
});

test("sshd: utente usato, provenienza e la riga del registro", () => {
  const m = mappa({ full_log: "sshd[1]: Invalid user da-ipam from 172.16.0.2 port 40000", data: { srcip: "172.16.0.2", srcuser: "da-ipam", srcport: "40000" } });
  assert.equal(m.get("Utente usato"), "da-ipam");
  assert.match(m.get("Riga del registro") ?? "", /Invalid user da-ipam/);
});

test("un evento vuoto o strano non rompe niente e i valori lunghi si accorciano", () => {
  assert.deepEqual(dettagliAlert(null), []);
  assert.deepEqual(dettagliAlert({ data: "x" }), []);
  const lungo = dettagliAlert({ data: { srcuser: "a".repeat(1000) } })[0].valore;
  assert.ok(lungo.length <= 241);
});
