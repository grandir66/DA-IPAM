/**
 * L'account LDAP dell'Active Directory è una voce dell'archivio (tappa 2f
 * credenziali, T24, 16/10).
 *
 * Perché: fino alla 2f l'account stava nella riga di `ad_integrations`
 * (`encrypted_username`, `encrypted_password`) e la pagina Credenziali non lo
 * vedeva; il T22 l'ha portato in una voce «AD · <nome>» (`credential_id`).
 * Qui lo leggono da lì i suoi utenti: il bind LDAP (`connectLdap`, quindi
 * `ad_sync`, la prova, la salute), kinit, l'identità per Wazuh. Le colonne
 * valgono solo per le righe MAI convertite (segno della 2f diverso da
 * `done:`), col ripiego registrato. Con D12 = (a) un DC nuovo scollega la voce
 * e svuota le colonne: l'account di dominio non parte, col bind, verso un
 * indirizzo che nessuno ha scelto. Il WinRM del DHCP e la sonda prendono la
 * porta dalla voce Windows (prima 5985 fissa).
 *
 * Niente rete: il client LDAP e il comando WinRM sono finti, passati ai punti
 * d'ingresso veri. Il DC è 127.0.0.1: se il codice ignorasse il finto,
 * tenterebbe una connessione locale, rifiutata subito.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/ad/__tests__/credenziale-ldap.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "ldapts";

import { encrypt } from "@/lib/crypto";
import {
  withTenant,
  getTenantDb,
  deleteTenantDatabase,
  createAdIntegration as createAdTenant,
  updateAdIntegration as updateAdTenant,
} from "@/lib/db-tenant";
import { getAdIntegrationById, type AdIntegration } from "@/lib/db";
import { connectLdap, syncAdDhcpLeases } from "../ad-client";
import { collectWinrmProbe } from "../health/winrm-probe";
import { creaIntegrazioneAd, aggiornaIntegrazioneAd } from "@/lib/credentials/lega-voce";
import { convertiControllerEAd } from "@/lib/credentials/converti-integrazioni";
import { collectSelfIdentity } from "@/lib/integrations/self-identity";
import { riepilogoRipieghi } from "@/lib/db-maintenance/ripieghi";

void TEST_DATA_DIR;
const T = "TESTCREDLDAP";
const dbt = () => getTenantDb(T);
const SEGNO = "credenziali_t2_integrazioni";
const PARZIALE = "parziale:2026-10-16T08:00:00.000Z:controller=0,chiave=0,utente=0,ad=0,lasciati=1";
const DONE = "done:2026-10-16T08:00:00.000Z:controller=0,chiave=0,utente=0,ad=1,lasciati=0";
const UTENTE = "CLIENTE\\svc-ldap";
const PASSWORD = "pw-ldap-0";

function segna(valore: string | null): void {
  dbt().prepare("DELETE FROM tenant_settings WHERE key = ?").run(SEGNO);
  if (valore) dbt().prepare("INSERT INTO tenant_settings (key, value) VALUES (?, ?)").run(SEGNO, valore);
}

function voce(nome: string, tipo: string, utente: string, password: string, porta: number | null = null): number {
  return Number(
    dbt()
      .prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password, port) VALUES (?, ?, ?, ?, ?)")
      .run(nome, tipo, encrypt(utente), encrypt(password), porta).lastInsertRowid,
  );
}

/** Una riga AD com'era prima della 2f: l'account nelle colonne, senza voce. */
function rigaVecchia(campi: { name?: string; dc_host?: string; winrm?: number | null; utente?: string; password?: string } = {}): number {
  return Number(
    dbt()
      .prepare(
        `INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, use_ssl, port, enabled, winrm_credential_id)
         VALUES (?, ?, 'cliente.local', 'DC=cliente,DC=local', ?, ?, 1, 1, 1, ?)`,
      )
      .run(
        campi.name ?? "Dominio",
        campi.dc_host ?? "127.0.0.1",
        campi.utente === "" ? "" : encrypt(campi.utente ?? UTENTE),
        campi.password === "" ? "" : encrypt(campi.password ?? PASSWORD),
        campi.winrm ?? null,
      ).lastInsertRowid,
  );
}

const riga = (id: number): AdIntegration => withTenant(T, () => getAdIntegrationById(id)) as AdIntegration;
const colonne = (id: number) =>
  dbt().prepare("SELECT credential_id, encrypted_username AS u, encrypted_password AS p FROM ad_integrations WHERE id = ?").get(id) as {
    credential_id: number | null;
    u: string;
    p: string;
  };
const ripieghiRiga = () => (riepilogoRipieghi(500).per_caso as Record<string, number | undefined>).cred_riga_integrazione ?? 0;

/** Client LDAP finto: registra url e bind, non apre niente. */
function ldapFinto() {
  const chiamate: Array<{ url: string; bind?: [string, string] }> = [];
  const nuovoClient = (opzioni: { url: string }): Client => {
    const c: { url: string; bind?: [string, string] } = { url: opzioni.url };
    chiamate.push(c);
    return {
      startTLS: async () => {},
      bind: async (dn: string, password: string) => {
        c.bind = [dn, password];
      },
    } as unknown as Client;
  };
  return { nuovoClient, chiamate };
}

/** Comando WinRM finto: registra host, porta e utente; risponde come una sonda vuota. */
function winrmFinto() {
  const chiamate: Array<{ host: string; port: number; username: string; password: string }> = [];
  const esegui = async (host: string, port: number, username: string, password: string): Promise<string> => {
    chiamate.push({ host, port, username, password });
    return "{}";
  };
  return { esegui, chiamate };
}

/** connectLdap col client finto, nel contesto del tenant. */
const lega = (i: AdIntegration, finto: ReturnType<typeof ldapFinto>) =>
  withTenant(T, () => (connectLdap as (i: AdIntegration, n: unknown) => Promise<Client>)(i, finto.nuovoClient));

const datiAd = { name: "Dominio", dc_host: "127.0.0.1", domain: "cliente.local", base_dn: "DC=cliente,DC=local", use_ssl: 1, port: 636, enabled: 1 };
type ConAccount = (input: typeof datiAd & { winrm_credential_id?: number | null }, account: unknown) => AdIntegration;
type AggiornaConAccount = (id: number, modifica: Record<string, unknown>, account?: unknown) => AdIntegration | undefined;
const crea = creaIntegrazioneAd as unknown as ConAccount;
const aggiorna = aggiornaIntegrazioneAd as unknown as AggiornaConAccount;

beforeEach(() => {
  deleteTenantDatabase(T);
  withTenant(T, () => dbt());
});
after(() => deleteTenantDatabase(T));

describe("connectLdap prende l'account dalla voce", () => {
  it("la voce dà lo stesso utente e la stessa password che erano nelle colonne", async () => {
    const id = rigaVecchia();
    segna(PARZIALE);
    // L'utente e la password che le colonne della riga contengono (prima della 2g il bind partiva con questi).
    const daColonne = { chiamate: [{ url: "ldaps://127.0.0.1:1", bind: [UTENTE, PASSWORD] }] };

    const esito = convertiControllerEAd(dbt(), { aVuoto: false });
    assert.equal(esito.ad.length, 1);
    // Come dopo la 2g: colonne vuote, segno chiuso. Resta solo la voce.
    dbt().prepare("UPDATE ad_integrations SET encrypted_username = '', encrypted_password = '' WHERE id = ?").run(id);
    segna(DONE);
    const daVoce = ldapFinto();
    await lega(riga(id), daVoce);
    assert.deepEqual(daVoce.chiamate, daColonne.chiamate);
  });

  it("riga mai convertita col segno parziale: dalla 2g (T26) le colonne non si leggono più: «Credenziale mancante», nessun bind, nessun ripiego", async () => {
    const id = rigaVecchia();
    segna(PARZIALE);
    const prima = ripieghiRiga();
    const finto = ldapFinto();
    await assert.rejects(lega(riga(id), finto), /Credenziale mancante/);
    assert.equal(finto.chiamate.length, 0, "nessun client verso il DC");
    assert.equal(ripieghiRiga(), prima);
  });

  it("riga senza voce col segno done: «Credenziale mancante», nessun bind e nessun ripiego", async () => {
    const id = rigaVecchia();
    segna(DONE);
    const prima = ripieghiRiga();
    const finto = ldapFinto();
    await assert.rejects(lega(riga(id), finto), /Credenziale mancante/);
    assert.equal(finto.chiamate.length, 0, "nessun client verso il DC");
    assert.equal(ripieghiRiga(), prima);
  });

  it("una voce che non è Active Directory non entra: nessun bind", async () => {
    const id = rigaVecchia();
    const win = voce("Admin Windows", "windows", "admin", "pw");
    dbt().prepare("UPDATE ad_integrations SET credential_id = ? WHERE id = ?").run(win, id);
    const finto = ldapFinto();
    await assert.rejects(lega(riga(id), finto), /Admin Windows/);
    assert.equal(finto.chiamate.length, 0);
  });
});

describe("D12: un DC nuovo scollega la voce", () => {
  /** Riga com'è dopo la conversione del T22: voce collegata, colonne ancora piene. */
  function convertita(): { id: number; voce: number } {
    const id = rigaVecchia();
    convertiControllerEAd(dbt(), { aVuoto: false });
    segna(DONE);
    const c = colonne(id);
    assert.notEqual(c.credential_id, null);
    assert.notEqual(c.u, "");
    return { id, voce: c.credential_id as number };
  }

  it("senza voce né account nuovi: voce scollegata, colonne vuote, «Credenziale mancante», nessun bind, nessun ripiego", async () => {
    const { id } = convertita();
    withTenant(T, () => aggiorna(id, { dc_host: "10.9.9.9" }));
    assert.deepEqual(colonne(id), { credential_id: null, u: "", p: "" });
    const prima = ripieghiRiga();
    const finto = ldapFinto();
    await assert.rejects(lega(riga(id), finto), /Credenziale mancante/);
    assert.equal(finto.chiamate.length, 0, "il bind non parte verso il DC nuovo");
    assert.equal(ripieghiRiga(), prima, "cred_riga_integrazione non scatta");
  });

  it("lo stesso DC scritto diverso (spazi, maiuscole) non è un DC nuovo", () => {
    const { id, voce: v } = convertita();
    withTenant(T, () => aggiorna(id, { dc_host: " 127.0.0.1 ", name: "Dominio" }));
    assert.equal(colonne(id).credential_id, v);
  });

  it("con la voce scelta di nuovo nella stessa richiesta: resta collegata", () => {
    const { id, voce: v } = convertita();
    withTenant(T, () => aggiorna(id, { dc_host: "10.9.9.9" }, { credential_id: v }));
    assert.equal(colonne(id).credential_id, v);
  });

  it("con un account nuovo nella stessa richiesta: voce nuova «AD · <nome>» col suffisso, la vecchia resta", async () => {
    const { id, voce: vecchia } = convertita();
    withTenant(T, () => aggiorna(id, { dc_host: "10.9.9.9" }, { nuovo: { username: "svc-nuovo", password: "pw-nuova" } }));
    const c = colonne(id);
    assert.notEqual(c.credential_id, null);
    assert.notEqual(c.credential_id, vecchia);
    const nuova = dbt().prepare("SELECT name, credential_type FROM credentials WHERE id = ?").get(c.credential_id) as { name: string; credential_type: string };
    assert.deepEqual(nuova, { name: `AD · Dominio (AD #${id})`, credential_type: "ad" });
    assert.ok(dbt().prepare("SELECT 1 FROM credentials WHERE id = ?").get(vecchia), "la voce vecchia non si tocca");
    const finto = ldapFinto();
    await lega(riga(id), finto);
    assert.deepEqual(finto.chiamate[0]?.bind, ["svc-nuovo", "pw-nuova"]);
  });

  it("una voce di un altro tipo scelta come account: rifiutata, niente cambia", () => {
    const { id, voce: v } = convertita();
    const win = voce("Admin Windows", "windows", "admin", "pw");
    assert.throws(
      () => withTenant(T, () => aggiorna(id, { name: "Cambiato" }, { credential_id: win })),
      (e: unknown) => e instanceof Error && e.name === "AccountLdapNonValido" && /Admin Windows/.test(e.message),
    );
    assert.equal(colonne(id).credential_id, v);
    assert.equal(riga(id).name, "Dominio");
  });
});

describe("una integrazione nuova entra con una voce", () => {
  it("dall'account scritto (pagina «Nuova nell'archivio» e wizard): voce «AD · <nome>» di tipo ad, colonne vuote", async () => {
    const ad = withTenant(T, () => crea({ ...datiAd, port: 1 }, { nuovo: { username: UTENTE, password: PASSWORD } }));
    const c = colonne(ad.id);
    assert.notEqual(c.credential_id, null);
    assert.equal(c.u, "");
    assert.equal(c.p, "");
    const v = dbt().prepare("SELECT name, credential_type FROM credentials WHERE id = ?").get(c.credential_id) as { name: string; credential_type: string };
    assert.deepEqual(v, { name: "AD · Dominio", credential_type: "ad" });
    const finto = ldapFinto();
    await lega(riga(ad.id), finto);
    assert.deepEqual(finto.chiamate[0]?.bind, [UTENTE, PASSWORD]);
  });

  it("con una voce scelta dall'archivio", () => {
    const v = voce("Account dominio", "ad", UTENTE, PASSWORD);
    const ad = withTenant(T, () => crea(datiAd, { credential_id: v }));
    assert.deepEqual(colonne(ad.id), { credential_id: v, u: "", p: "" });
  });

  it("una voce Windows come account: rifiutata, nessuna riga", () => {
    const win = voce("Admin Windows", "windows", "admin", "pw");
    assert.throws(
      () => withTenant(T, () => crea(datiAd, { credential_id: win })),
      (e: unknown) => e instanceof Error && e.name === "AccountLdapNonValido",
    );
    assert.equal((dbt().prepare("SELECT COUNT(*) AS n FROM ad_integrations").get() as { n: number }).n, 0);
  });

  it("le gemelle di db-tenant scrivono credential_id", () => {
    const v = voce("Account dominio", "ad", UTENTE, PASSWORD);
    const ad = withTenant(T, () =>
      (createAdTenant as unknown as (i: Record<string, unknown>) => AdIntegration)({ ...datiAd, encrypted_username: "", encrypted_password: "", credential_id: v }),
    );
    assert.equal(colonne(ad.id).credential_id, v);
    withTenant(T, () => (updateAdTenant as unknown as (id: number, i: Record<string, unknown>) => AdIntegration)(ad.id, { credential_id: null }));
    assert.equal(colonne(ad.id).credential_id, null);
  });
});

describe("WinRM del DC: la porta della voce", () => {
  it("la sonda usa la 5986 se la voce Windows la porta", async () => {
    const win = voce("Admin Windows", "windows", "CLIENTE\\admin", "pw-win", 5986);
    const id = rigaVecchia({ winrm: win });
    const finto = winrmFinto();
    const r = await withTenant(T, () => (collectWinrmProbe as (id: number, e: unknown) => ReturnType<typeof collectWinrmProbe>)(id, finto.esegui));
    assert.equal(r.status, "ok", r.errorMessage);
    assert.deepEqual(finto.chiamate, [{ host: "127.0.0.1", port: 5986, username: "CLIENTE\\admin", password: "pw-win" }]);
  });

  // Revisione della 2f (16/10): il DHCP non aveva una prova, e rimettere la
  // 5985 fissa lasciava verdi tutte le prove.
  it("il DHCP del DC usa la 5986 se la voce Windows la porta", async () => {
    const win = voce("Admin Windows", "windows", "CLIENTE\\admin", "pw-win", 5986);
    const id = rigaVecchia({ winrm: win });
    const finto = winrmFinto();
    const n = await withTenant(T, () => syncAdDhcpLeases(riga(id), finto.esegui));
    assert.equal(n, 0, "nessuno scope nella risposta finta");
    assert.deepEqual(finto.chiamate, [{ host: "127.0.0.1", port: 5986, username: "CLIENTE\\admin", password: "pw-win" }]);
  });

  it("senza porta nella voce, la 5985", async () => {
    const win = voce("Admin Windows", "windows", "admin", "pw-win");
    const id = rigaVecchia({ winrm: win });
    const finto = winrmFinto();
    await withTenant(T, () => (collectWinrmProbe as (id: number, e: unknown) => ReturnType<typeof collectWinrmProbe>)(id, finto.esegui));
    assert.equal(finto.chiamate[0]?.port, 5985);
  });

  it("una voce che non è Windows non parte: sonda non disponibile col motivo", async () => {
    const ad = voce("Account dominio", "ad", UTENTE, PASSWORD);
    const id = rigaVecchia({ winrm: ad });
    const finto = winrmFinto();
    const r = await withTenant(T, () => (collectWinrmProbe as (id: number, e: unknown) => ReturnType<typeof collectWinrmProbe>)(id, finto.esegui));
    assert.equal(r.status, "unavailable");
    assert.match(r.errorMessage ?? "", /Account dominio.*WinRM/);
    assert.equal(finto.chiamate.length, 0);
  });
});

describe("identità per Wazuh", () => {
  it("l'account della voce c'è; quello rimasto nelle colonne di una riga chiusa (done) no", () => {
    const v = voce("AD · Dominio", "ad", "svc-ldap@cliente.local", PASSWORD);
    const collegata = rigaVecchia({ name: "Collegata", utente: "", password: "" });
    dbt().prepare("UPDATE ad_integrations SET credential_id = ? WHERE id = ?").run(v, collegata);
    rigaVecchia({ name: "Scollegata", dc_host: "10.0.0.2", utente: "vecchio-ldap" });
    segna(DONE);
    const s = collectSelfIdentity(dbt());
    assert.ok(s.accounts.includes("svc-ldap"), "manca l'account della voce");
    assert.equal(s.accounts.includes("vecchio-ldap"), false, "l'account nelle colonne non lo usa più nessuno");
  });

  it("un account che non si legge si scrive nel registro una volta, non a ogni giro", () => {
    const v = Number(
      dbt()
        .prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES ('AD · Rotta', 'ad', 'aa:bb:cc', ?)")
        .run(encrypt(PASSWORD)).lastInsertRowid,
    );
    const id = rigaVecchia({ name: "Rotta", utente: "", password: "" });
    dbt().prepare("UPDATE ad_integrations SET credential_id = ? WHERE id = ?").run(v, id);
    segna(DONE);
    const avvisi: string[] = [];
    const originale = console.warn;
    console.warn = (...a: unknown[]) => {
      avvisi.push(a.map(String).join(" "));
    };
    try {
      collectSelfIdentity(dbt());
      collectSelfIdentity(dbt());
    } finally {
      console.warn = originale;
    }
    const nostri = avvisi.filter((a) => a.startsWith("[self-identity]"));
    assert.equal(nostri.length, 1, JSON.stringify(avvisi));
    assert.match(nostri[0], new RegExp(`AD #${id}`));
  });
});
