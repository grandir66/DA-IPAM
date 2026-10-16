/**
 * L'account LDAP dell'AD nella richiesta e nella vista della pagina (tappa 2f
 * credenziali, T24, 16/10).
 *
 * Perché: dalla 2f l'account è una voce dell'archivio. La richiesta porta la
 * voce scelta oppure un account nuovo, mai tutti e due e mai un account a
 * metà (prima la modifica accettava la sola password, che finiva nella riga);
 * la vista dice alla pagina con che cosa entra la riga (voce, colonne di una
 * riga mai convertita, niente) senza mandarle segreti.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/ad/__tests__/account-ldap.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { encrypt } from "@/lib/crypto";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { getAdIntegrations } from "@/lib/db";
import { accountDalCorpo, nomeVoceAd, stessoDc } from "../account-ldap";
import { vistaIntegrazioniAd } from "../credenziale-ldap";

void TEST_DATA_DIR;
const T = "TESTACCOUNTLDAP";
const dbt = () => getTenantDb(T);

describe("accountDalCorpo", () => {
  it("la voce scelta", () => {
    assert.deepEqual(accountDalCorpo({ credential_id: 7 }, true), { ok: true, account: { credential_id: 7 } });
  });

  it("un account nuovo, com'è scritto (il wizard e «Nuova nell'archivio»)", () => {
    assert.deepEqual(accountDalCorpo({ username: "CLIENTE\\svc", password: " pw " }, true), {
      ok: true,
      account: { nuovo: { username: "CLIENTE\\svc", password: " pw " } },
    });
  });

  it("voce e account insieme: rifiutato", () => {
    const e = accountDalCorpo({ credential_id: 7, username: "u", password: "p" }, true);
    assert.equal(e.ok, false);
  });

  it("un account a metà (solo la password, solo l'utente): rifiutato", () => {
    assert.equal(accountDalCorpo({ password: "p" }, false).ok, false);
    assert.equal(accountDalCorpo({ username: "u" }, false).ok, false);
    assert.equal(accountDalCorpo({ username: "  ", password: "p" }, false).ok, false);
  });

  it("niente: in creazione è un errore, in modifica resta quello di adesso", () => {
    assert.equal(accountDalCorpo({}, true).ok, false);
    assert.deepEqual(accountDalCorpo({ credential_id: null, username: "", password: "" }, false), { ok: true, account: null });
  });
});

describe("regole pure", () => {
  it("stesso DC senza spazi attorno e senza maiuscole; un altro indirizzo no", () => {
    assert.equal(stessoDc(" DC01.Cliente.local ", "dc01.cliente.local"), true);
    assert.equal(stessoDc("10.0.0.1", "10.0.0.2"), false);
  });

  it("nome della voce nuova", () => {
    assert.equal(nomeVoceAd(" Dominio "), "AD · Dominio");
  });
});

describe("vista per la pagina", () => {
  beforeEach(() => {
    deleteTenantDatabase(T);
    withTenant(T, () => dbt());
  });
  after(() => deleteTenantDatabase(T));

  function riga(nome: string, dc: string, u: string, p: string, voce: number | null): void {
    dbt()
      .prepare(
        `INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, credential_id)
         VALUES (?, ?, 'cliente.local', 'DC=cliente,DC=local', ?, ?, ?)`,
      )
      .run(nome, dc, u, p, voce);
  }

  it("voce, forma vecchia o mancante; nome della voce; nessun segreto", () => {
    const voce = Number(
      dbt()
        .prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('AD · Uno', 'ad', ?, ?)")
        .run(encrypt("u"), encrypt("p")).lastInsertRowid,
    );
    riga("Uno", "10.0.0.1", "", "", voce);
    riga("Due", "10.0.0.2", encrypt("u"), encrypt("p"), null);
    riga("Tre", "10.0.0.3", "", "", null);
    const segna = (v: string) =>
      dbt()
        .prepare("INSERT INTO tenant_settings (key, value) VALUES ('credenziali_t2_integrazioni', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(v);

    segna("parziale:2026-10-16T08:00:00.000Z:controller=0,chiave=0,utente=0,ad=0,lasciati=1");
    const vista = withTenant(T, () => vistaIntegrazioniAd(getAdIntegrations()));
    const per = Object.fromEntries(vista.map((v) => [v.name, v]));
    assert.deepEqual(
      Object.fromEntries(vista.map((v) => [v.name, [v.account, v.credential_name]])),
      { Uno: ["voce", "AD · Uno"], Due: ["forma_vecchia", null], Tre: ["mancante", null] },
    );
    for (const v of vista) {
      assert.equal("encrypted_username" in v && v.encrypted_username !== undefined, false);
      assert.equal("encrypted_password" in v && v.encrypted_password !== undefined, false);
    }
    assert.equal(per.Uno.credential_id, voce);

    // Col segno done le colonne non valgono più: la riga senza voce è «mancante».
    segna("done:2026-10-16T08:00:00.000Z:controller=0,chiave=0,utente=0,ad=1,lasciati=0");
    const dopo = withTenant(T, () => vistaIntegrazioniAd(getAdIntegrations()));
    assert.equal(dopo.find((v) => v.name === "Due")?.account, "mancante");
  });
});
