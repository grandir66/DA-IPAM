/**
 * Chi lega una voce a un protocollo controlla il tipo (tappa 2 credenziali,
 * T13, 16/10).
 *
 * Perché: dalla 2c l'archivio ha voci UniFi, Omada e Active Directory, che non
 * valgono per nessun protocollo d'accesso. Il controllo del tipo c'era solo
 * sulle catene vecchie della rete: un binding WinRM, una riga host o il WinRM
 * dell'AD con una voce AD si salvavano, e il motore poi la scartava in
 * silenzio (D7 = (a): l'account AD mai nelle tendine WinRM). La lista unica
 * della rete accettava qualunque voce.
 *
 * Le rotte non si chiamano in una prova (sessione di NextAuth): si prova la
 * regola sul DB vero e si legge nel sorgente di ogni rotta che il controllo
 * viene prima della scrittura.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/credentials/__tests__/voci-per-protocollo.test.ts
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { encrypt } from "@/lib/crypto";
import {
  withTenant,
  getTenantDb,
  deleteTenantDatabase,
  getCredentialById,
  replaceNetworkCredentials as sostituisciTenant,
  addNetworkCredential as aggiungiTenant,
  copyNetworkCredentials as copiaTenant,
} from "@/lib/db-tenant";
import {
  replaceNetworkCredentials as sostituisciFacciata,
  addNetworkCredential as aggiungiFacciata,
  copyNetworkCredentials as copiaFacciata,
} from "@/lib/db";
import { aggiornaRete, CredenzialiReteNonValide } from "@/lib/networks/salva-rete";
import { erroreVocePerProtocollo, erroreVocePerRete, valePerAccesso } from "../tipi";
import { CredenzialeNonAmmessa } from "../lista-rete";

const T = "TESTVOCIPROTOCOLLO";
const dbt = () => getTenantDb(T);

const voce = (nome: string, tipo: string): number =>
  Number(
    dbt()
      .prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)")
      .run(nome, tipo, encrypt("utente"), encrypt("segreto")).lastInsertRowid,
  );

const lista = (networkId: number) =>
  (dbt().prepare("SELECT credential_id FROM network_credentials WHERE network_id = ? ORDER BY sort_order").all(networkId) as Array<{ credential_id: number }>).map(
    (r) => r.credential_id,
  );

let AD = 0;
let SSH = 0;
let WIN = 0;
let rete = 0;
let reteSorgente = 0;

before(() => {
  withTenant(T, () => {
    AD = voce("Account dominio", "ad");
    SSH = voce("Router SSH", "ssh");
    WIN = voce("Admin Windows", "windows");
    rete = Number(dbt().prepare("INSERT INTO networks (cidr, name) VALUES ('10.73.0.0/24', 'rete')").run().lastInsertRowid);
    reteSorgente = Number(dbt().prepare("INSERT INTO networks (cidr, name) VALUES ('10.73.1.0/24', 'sorgente')").run().lastInsertRowid);
  });
});

after(() => deleteTenantDatabase(T));

describe("la regola, sulle voci vere dell'archivio", () => {
  it("una voce AD non vale per WinRM: messaggio col nome, il tipo e il protocollo", () => {
    withTenant(T, () => {
      assert.equal(
        erroreVocePerProtocollo(AD, getCredentialById(AD), "winrm"),
        "La credenziale «Account dominio» è di tipo Active Directory, non vale per WinRM",
      );
      assert.equal(erroreVocePerProtocollo(WIN, getCredentialById(WIN), "winrm"), null);
      assert.equal(erroreVocePerProtocollo(SSH, getCredentialById(SSH), "api"), null, "Proxmox con root: SSH vale per API");
      assert.equal(erroreVocePerProtocollo(424242, undefined, "ssh"), "La credenziale #424242 non esiste nell'archivio");
    });
  });

  it("nelle reti: solo le voci d'accesso (SSH, SNMP, Windows, API)", () => {
    for (const t of ["ssh", "linux", "snmp", "snmp_v3", "windows", "api"]) assert.equal(valePerAccesso(t), true, t);
    for (const t of ["unifi", "omada", "ad", "boh"]) assert.equal(valePerAccesso(t), false, t);
    assert.match(erroreVocePerRete({ name: "Account dominio", credential_type: "ad" }) ?? "", /Active Directory/);
    assert.equal(erroreVocePerRete({ name: "x", credential_type: "snmp_v3" }), null);
  });
});

describe("una voce AD nella lista di una rete → 400", () => {
  for (const [nome, sostituisci, aggiungi, copia] of [
    ["db-tenant", sostituisciTenant, aggiungiTenant, copiaTenant],
    ["facciata db.ts", sostituisciFacciata, aggiungiFacciata, copiaFacciata],
  ] as const) {
    it(`${nome}: sostituzione, aggiunta e copia rifiutano, la lista resta com'era`, () => {
      withTenant(T, () => {
        sostituisci(rete, [SSH]);
        assert.throws(() => sostituisci(rete, [WIN, AD]), (e: unknown) => e instanceof CredenzialeNonAmmessa && /Active Directory/.test(e.message));
        assert.deepEqual(lista(rete), [SSH]);
        assert.throws(() => aggiungi(rete, AD), (e: unknown) => e instanceof CredenzialeNonAmmessa);
        assert.deepEqual(lista(rete), [SSH]);
        dbt().prepare("DELETE FROM network_credentials WHERE network_id = ?").run(reteSorgente);
        dbt().prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, 0)").run(reteSorgente, AD);
        assert.throws(() => copia(reteSorgente, rete), (e: unknown) => e instanceof CredenzialeNonAmmessa);
        assert.deepEqual(lista(rete), [SSH]);
      });
    });
  }

  it("il PUT della rete (aggiornaRete) lo rende un rifiuto, cioè un 400", () => {
    withTenant(T, () => {
      assert.throws(
        () => aggiornaRete(rete, { credential_ids: [AD] }),
        (e: unknown) => e instanceof CredenzialiReteNonValide && /Active Directory/.test(e.message),
      );
    });
  });
});

// ── le rotte: il controllo viene prima della scrittura ──

const RADICE = process.cwd();

/** Il testo del gestore esportato `metodo` (POST, PUT…) di una rotta. */
function gestore(rotta: string, metodo: string): string {
  const sorgente = readFileSync(join(RADICE, rotta), "utf8");
  const sf = ts.createSourceFile(rotta, sorgente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const f = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === metodo);
  assert.ok(f?.body, `${metodo} non trovato in ${rotta}`);
  return f.body.getText(sf);
}

/** In `testo`, il controllo del tipo viene prima di ogni chiamata a `scrittore`, e il rifiuto è un 400. */
function controlloPrimaDi(testo: string, scrittore: string, dove: string): void {
  const controllo = testo.indexOf("erroreVocePerProtocollo(");
  assert.ok(controllo >= 0, `${dove}: nessun controllo del tipo (erroreVocePerProtocollo)`);
  let i = testo.indexOf(`${scrittore}(`);
  assert.ok(i >= 0, `${dove}: ${scrittore} non chiamata`);
  while (i >= 0) {
    assert.ok(controllo < i, `${dove}: ${scrittore} viene prima del controllo del tipo`);
    i = testo.indexOf(`${scrittore}(`, i + 1);
  }
  assert.match(testo.slice(controllo), /status:\s*400/, `${dove}: il rifiuto non è un 400`);
}

describe("una voce AD come binding WinRM → 400", () => {
  it("POST e azione «update» di /api/devices/[id]/credentials controllano il tipo prima di scrivere", () => {
    const r = "src/app/api/devices/[id]/credentials/route.ts";
    controlloPrimaDi(gestore(r, "POST"), "addDeviceCredentialBinding", `${r} POST`);
    controlloPrimaDi(gestore(r, "PUT"), "updateDeviceCredentialBinding", `${r} PUT update`);
  });
});

describe("una voce AD come riga host WinRM → 400", () => {
  it("POST di /api/hosts/[id]/credentials e la modifica in blocco degli host controllano il tipo prima di scrivere", () => {
    const r = "src/app/api/hosts/[id]/credentials/route.ts";
    controlloPrimaDi(gestore(r, "POST"), "addHostCredential", `${r} POST`);
    const b = "src/app/api/hosts/bulk-update/route.ts";
    const testo = gestore(b, "PATCH");
    controlloPrimaDi(testo, "addHostCredential", `${b} PATCH`);
    controlloPrimaDi(testo, "addDeviceCredentialBinding", `${b} PATCH`);
  });
});

describe("una voce AD come winrm_credential_id dell'AD → 400", () => {
  it("POST di /api/ad e PUT di /api/ad/[id] controllano il tipo prima di scrivere", () => {
    controlloPrimaDi(gestore("src/app/api/ad/route.ts", "POST"), "createAdIntegration", "api/ad POST");
    controlloPrimaDi(gestore("src/app/api/ad/[id]/route.ts", "PUT"), "updateAdIntegration", "api/ad/[id] PUT");
  });

  it("il controllo usa il protocollo WinRM", () => {
    for (const r of ["src/app/api/ad/route.ts", "src/app/api/ad/[id]/route.ts"]) {
      assert.match(readFileSync(join(RADICE, r), "utf8"), /erroreVocePerProtocollo\([^;]*,\s*"winrm"\)/, r);
    }
  });
});
