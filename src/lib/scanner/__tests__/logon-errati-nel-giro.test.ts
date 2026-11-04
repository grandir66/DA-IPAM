/**
 * La prova d'insieme dell'anti-blocco: il vero `discoverNetwork`, i veri bridge Python, `winrm`, `impacket` e `kinit` finti che
 * scrivono ogni tentativo in un registro. Si contano i logon errati veri, non le chiamate alla prova.
 *
 * Il principio: il limite conta i logon errati, non le voci e non le chiamate. Con 3 chiamate da quattro logon ciascuna un
 * account di dominio prendeva dodici logon errati in un giro, e con la soglia di blocco di AD a 5 o 10 il danno era fatto.
 * Revisione del 04/11/2026.
 *
 * Run: node --import tsx --test src/lib/scanner/__tests__/logon-errati-nel-giro.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import fs from "node:fs";
import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { creaBridgeFinto, PYTHON } from "@/lib/devices/__tests__/support/bridge-winrm-finto";
import { runWmiIdentita } from "@/lib/devices/wmi-run";
import { MAX_CONSECUTIVE_FAILURES_PER_RUN } from "@/lib/scanner/credential-anti-lockout";
import { CHIAVE_PROVE_ACCESSO_WINDOWS, discoverNetwork, provaWinrmConTetto, type ProveAccessoWindows } from "@/lib/scanner/discovery";
import { utenteNormalizzato } from "@/lib/scanner/account-windows";
import { provaLdapDellaVoce, provaSmbDellaVoce } from "@/lib/scanner/verifica-password-run";
import { creaEsecutoreFinto, installaEsecutoreFinto, togliEsecutoreFinto } from "./support/esecutore-finto";

const salta = PYTHON ? false : "python3 non disponibile";
const banco = creaBridgeFinto();
const creati = new Set<string>();
const HOST = 50;

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CHIAVE_PROVE_ACCESSO_WINDOWS];
  togliEsecutoreFinto();
});

after(() => {
  for (const c of creati) deleteTenantDatabase(c);
  closeHubDb();
  banco.togli();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

let progressivo = 0;

interface Voce {
  utente: string;
  password: string;
}

/** Un tenant con `HOST` host: le porte vengono da `porte`, le voci sono nella lista della rete. Nessuna integrazione AD: `non_so`. */
function giroSu(porte: (i: number) => number[], voci: Voce[], tipo: "windows" | "credential_validate") {
  const code = `TESTLOGON${++progressivo}`;
  deleteTenantDatabase(code);
  creati.add(code);
  const ips: string[] = [];
  const rete = withTenant(code, () => {
    const d = getTenantDb(code);
    const id = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.78.0.0/24', 'Clienti')").run().lastInsertRowid);
    const ins = d.prepare("INSERT INTO hosts (network_id, ip, status, open_ports) VALUES (?, ?, 'online', ?)");
    for (let i = 1; i <= HOST; i++) {
      ips.push(`10.78.0.${i}`);
      ins.run(id, `10.78.0.${i}`, JSON.stringify(porte(i).map((port) => ({ port, protocol: "tcp" }))));
    }
    voci.forEach((v, n) => {
      const cred = Number(
        d.prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, 'windows', ?, ?)")
          .run(`Voce ${n}`, encrypt(v.utente), encrypt(v.password)).lastInsertRowid,
      );
      d.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)").run(id, cred, n);
    });
    return id;
  });

  const prove: ProveAccessoWindows = {
    winrm: provaWinrmConTetto(banco.dipendenze({ kerberos: "rifiuta", ntlm: "rifiuta", credssp: "rifiuta", basic: "rifiuta" })),
    wmi: (host, username, password) => runWmiIdentita(host, username, password, banco.dipendenzeWmi()),
    ldap: (credId) => provaLdapDellaVoce(credId),
    smb: (credId, ip) => provaSmbDellaVoce(credId, ip),
  };
  (globalThis as Record<symbol, unknown>)[CHIAVE_PROVE_ACCESSO_WINDOWS] = prove;
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: ips }).override);

  return (async () => {
    const prima = banco.logon().length;
    const avvio = await withTenant(code, () => discoverNetwork(rete, tipo, undefined, null, { targetIps: ips }));
    const esito = await avvio.done;
    assert.equal(esito.status, "completed", JSON.stringify(esito));
    return { logon: banco.logon().slice(prima), log: (avvio.progress.logs ?? []).join("\n") };
  })();
}

/** Quanti logon errati ha preso ogni account. */
function perAccount(logon: string[]): Map<string, number> {
  const conti = new Map<string, number>();
  for (const riga of logon) {
    const utente = utenteNormalizzato(riga.split(":").slice(-1)[0]);
    conti.set(utente, (conti.get(utente) ?? 0) + 1);
  }
  return conti;
}

const ACCOUNT: Voce = { utente: "CLIENTE\\scansioni", password: "Password-sbagliata!1" };
const LIMITE = MAX_CONSECUTIVE_FAILURES_PER_RUN;

for (const tipo of ["windows", "credential_validate"] as const) {
  describe(`${tipo}: ${HOST} host, password errata, verifica che non sa rispondere`, () => {
    const casi: Array<[string, (i: number) => number[]]> = [
      ["solo WinRM", () => [5985]],
      ["solo WMI", () => [135]],
      ["WinRM e WMI aperti", () => [135, 5985]],
      ["WinRM su HTTPS", () => [5986]],
      ["host misti", (i) => (i % 2 === 0 ? [135] : [5985])],
    ];
    for (const [nome, porte] of casi) {
      it(`${nome}: al massimo ${LIMITE} logon errati per l'account`, { skip: salta, timeout: 120_000 }, async () => {
        const { logon, log } = await giroSu(porte, [ACCOUNT], tipo);
        assert.ok(logon.length <= LIMITE, `${logon.length} logon errati:\n${logon.join("\n")}`);
        assert.ok(logon.length > 0, "il banco non ha fatto nessun logon: la prova non proverebbe niente");
        assert.match(log, /esclusa/);
      });
    }

    it(`due voci con lo stesso account, scritte in due forme: ${LIMITE} logon in tutto`, { skip: salta, timeout: 120_000 }, async () => {
      const { logon } = await giroSu(() => [5985], [ACCOUNT, { utente: "scansioni@cliente.local", password: ACCOUNT.password }], tipo);
      assert.equal(perAccount(logon).get("scansioni@cliente"), LIMITE, logon.join("\n"));
    });

    it("due account diversi: ciascuno col suo limite", { skip: salta, timeout: 120_000 }, async () => {
      const { logon } = await giroSu(() => [5985], [ACCOUNT, { utente: "CLIENTE\\altro", password: "Altra-sbagliata!1" }], tipo);
      const conti = perAccount(logon);
      assert.equal(conti.get("scansioni@cliente"), LIMITE, logon.join("\n"));
      assert.equal(conti.get("altro@cliente"), LIMITE, logon.join("\n"));
    });
  });
}
