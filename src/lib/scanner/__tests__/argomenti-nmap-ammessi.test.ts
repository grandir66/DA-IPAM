/**
 * Secondo giro di sicurezza, 16/11/2026. Il profilo nmap accetta un testo libero di argomenti, che arrivava a
 * nmap così com'era; nmap gira da root. Con `--script`, `-oN`, `-iL` o `--datadir` un amministratore
 * dell'interfaccia scriveva file o eseguiva codice sul sistema. Passano solo le opzioni di scansione.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { motivoArgomentiRifiutati } from "../argomenti-nmap-ammessi";
import { buildTcpScanArgs, buildUdpScanArgs } from "../ports";

test("gli argomenti che DA-IPAM costruisce da solo passano", () => {
  assert.equal(motivoArgomentiRifiutati(buildTcpScanArgs(null)), null);
  assert.equal(motivoArgomentiRifiutati(buildUdpScanArgs(null)), null);
  assert.equal(motivoArgomentiRifiutati("-Pn -sT -p- --exclude-ports 9100,9101 -T4 --max-retries 1 --max-rate 300 --host-timeout 90000ms"), null);
  assert.equal(motivoArgomentiRifiutati("-sT -p T:22,80,U:161 -sV --version-intensity=5 --top-ports 100 -sn"), null);
});

test("script, file di uscita, file di ingresso e cartelle dati sono rifiutati", () => {
  for (const a of [
    "-sT -p 80 --script /tmp/x.nse",
    "-sT --script=http-title",
    "-sT -p 80 -oN /etc/cron.d/x",
    "-sT -oG/etc/cron.d/x",
    "-iL /etc/shadow",
    "--datadir /tmp",
    "--script-args x=y",
    "-sT --resume /tmp/x",
    "-sT --stylesheet http://x",
  ]) {
    assert.notEqual(motivoArgomentiRifiutati(a), null, a);
  }
});

test("niente bersagli in più e niente valori fuori forma", () => {
  assert.notEqual(motivoArgomentiRifiutati("-sT 10.0.0.0/8"), null);
  assert.notEqual(motivoArgomentiRifiutati("-p 80;id"), null);
  assert.notEqual(motivoArgomentiRifiutati("--max-retries"), null);
  assert.notEqual(motivoArgomentiRifiutati("--host-timeout $(id)"), null);
});
