/**
 * Controlli con credenziali già validate (Riccardo, 10/11/2026): si legge solo l'uscita attesa;
 * un apparato che non ha una shell POSIX non produce rilievi inventati.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eRifiutoSsh, eShellPosix, leggiUscitaSsh } from "../autenticati";
import { rilieviDaControllo } from "../controlli";

const USCITA = `##SSHD
PermitRootLogin yes
permitemptypasswords no
##UID0
root
toor
##RIAVVIO
si
##AGG
7
##FINE
`;

test("uscita attesa: root con password, UID 0 in più, riavvio, aggiornamenti", () => {
  assert.deepEqual(leggiUscitaSsh(USCITA), { root_password: true, uid0: ["toor"], riavvio: true, agg_sicurezza: 7 });
});

test("macchina a posto: nessun campo; uscita estranea: null", () => {
  assert.deepEqual(leggiUscitaSsh("##SSHD\npermitrootlogin prohibit-password\n##UID0\nroot\n##RIAVVIO\n##AGG\n0\n##FINE\n"), {});
  assert.equal(leggiUscitaSsh("bad command name echo (line 1 column 1)"), null);
  assert.equal(leggiUscitaSsh("##SSHD\npermitrootlogin yes\n"), null);
});

test("solo OpenSSH si interroga; il rifiuto si distingue dal timeout", () => {
  assert.equal(eShellPosix("SSH-2.0-OpenSSH_9.6p1 Ubuntu"), true);
  assert.equal(eShellPosix("SSH-2.0-ROSSSH"), false);
  assert.equal(eShellPosix(null), false);
  assert.equal(eRifiutoSsh("Authentication failed."), true);
  assert.equal(eRifiutoSsh("timed out"), false);
});

test("i rilievi dicono che vengono dalla credenziale validata", () => {
  const ctx = { host_id: 1, ip: "10.0.0.5", hostname: null, network_id: 1, network_name: "lan", porta: 22 };
  const r = rilieviDaControllo({ auth_ssh: { root_password: true, uid0: ["toor"] }, snmp_community_gestione: true }, ctx);
  assert.deepEqual(r.map((x) => x.id.split(":")[1]).sort(), ["auth-ssh-root", "auth-uid0", "snmp-community-gestione"]);
  assert.match(r.find((x) => x.id.includes("auth-uid0"))!.prova, /credenziale SSH già validata/);
});
