/**
 * da-vault, passo 10 (D2): «Mostra password». Non si chiede la passphrase del cliente (i tecnici non la devono
 * conoscere): si chiede la verifica in due passaggi dell'utente collegato (ADR 0023). La conferma dura 5 minuti ed è
 * solo per gli admin; ogni visualizzazione va nel registro con utente e ora, e il registro si legge da una pagina.
 * Con gli interruttori spenti la funzione non c'è (404), come oggi.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/mostra.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encrypt } from "@/lib/crypto";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb, createUser, impostaSecondaVerifica } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { verificaAccessoLocale } from "@/lib/accesso/accesso-locale";
import { codiceTotp } from "@/lib/accesso/totp";
import { clearRateLimit } from "@/lib/rate-limit";
import { confermaConSecondaVerifica, confermaValida, DURATA_CONFERMA_MS, mostraVoce, registroVisualizzazioni, type UtenteSessione } from "../mostra";
import { chiudiVault, impostaChiaveDati, statoVaultProcesso } from "../stato";

const T = "VAULTMOSTRA";
const PW = "Pw-mostra-prova-4d5e";
const ORA = Date.parse("2026-10-23T10:00:00Z");
const passo = (ms: number) => Math.floor(ms / 30_000);

let admin: UtenteSessione;
let adminSenza2fa: UtenteSessione;
let viewer: UtenteSessione;
let segretoTotp: string;
let idVoce: number;

async function con2fa(username: string, ruolo: "admin" | "viewer"): Promise<{ u: UtenteSessione; segreto: string }> {
  const bcrypt = await import("bcrypt");
  const r = createUser(username, await bcrypt.hash("giusta", 4), ruolo, null);
  impostaSecondaVerifica(r.id, "richiedi");
  const p1 = await verificaAccessoLocale({ username, password: "giusta" }, { fase: "passo_uno", ora: ORA - 600_000 });
  if (p1.esito !== "serve_attivazione") throw new Error("attivazione non proposta");
  const fine = await verificaAccessoLocale({ username, password: "giusta", codice: codiceTotp(p1.segreto, passo(ORA - 600_000)) }, { fase: "accesso", ora: ORA - 600_000 });
  assert.equal(fine.esito, "entra");
  return { u: { id: String(r.id), nome: username, ruolo }, segreto: p1.segreto };
}

before(async () => {
  const a = await con2fa("tecnico-admin", "admin");
  admin = a.u;
  segretoTotp = a.segreto;
  const bcrypt = await import("bcrypt");
  const s = createUser("admin-senza", await bcrypt.hash("giusta", 4), "admin", null);
  adminSenza2fa = { id: String(s.id), nome: "admin-senza", ruolo: "admin" };
  viewer = (await con2fa("cliente-viewer", "viewer")).u;
  withTenant(T, () => {
    idVoce = creaCredenzialeDb(getTenantDb(T), { name: "Firewall sede", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt(PW) }).id;
  });
});

after(() => {
  delete process.env.DA_VAULT_LOCALE;
  chiudiVault(null);
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

beforeEach(() => {
  process.env.DA_VAULT_LOCALE = "1";
  if (!statoVaultProcesso().chiaveDati) impostaChiaveDati(randomBytes(32), "tpm");
  statoVaultProcesso().conferme.clear();
  clearRateLimit(`vault-conferma:${admin.id}`);
});

const mostra = (u: UtenteSessione, ora: number) => withTenant(T, () => mostraVoce({ dbh: getTenantDb(T), utente: u, credentialId: idVoce, ora }));

describe("interruttori spenti", () => {
  it("la funzione non c'è: 404 per la conferma e per la visualizzazione, nessuna riga nel registro", async () => {
    delete process.env.DA_VAULT_LOCALE;
    const c = confermaConSecondaVerifica({ utente: admin, codice: codiceTotp(segretoTotp, passo(ORA)), ora: ORA });
    assert.equal(c.ok ? 200 : c.stato, 404);
    const m = await mostra(admin, ORA);
    assert.equal(m.ok ? 200 : m.stato, 404);
    withTenant(T, () => assert.equal(registroVisualizzazioni(getTenantDb(T)).totale, 0));
  });
});

describe("chi può", () => {
  it("un viewer no (403), anche con la 2FA attiva", () => {
    const c = confermaConSecondaVerifica({ utente: viewer, codice: "123456", ora: ORA });
    assert.equal(c.ok ? 200 : c.stato, 403);
  });

  it("un admin senza 2FA attiva no, e il messaggio dice perché", () => {
    const c = confermaConSecondaVerifica({ utente: adminSenza2fa, codice: "123456", ora: ORA });
    assert.equal(c.ok, false);
    assert.match(c.ok ? "" : c.errore, /verifica in due passaggi/);
  });

  it("l'utenza di servizio (id 0) no", () => {
    const c = confermaConSecondaVerifica({ utente: { id: "0", nome: "domarc", ruolo: "admin" }, codice: "123456", ora: ORA });
    assert.equal(c.ok ? 200 : c.stato, 403);
  });
});

describe("conferma con la 2FA, 5 minuti", () => {
  it("senza conferma: 403 e niente valori", async () => {
    const m = await mostra(admin, ORA);
    assert.equal(m.ok ? 200 : m.stato, 403);
    assert.ok(!JSON.stringify(m).includes(PW));
  });

  it("codice sbagliato: 403; un codice già usato non vale due volte", async () => {
    const sbagliato = confermaConSecondaVerifica({ utente: admin, codice: "000000", ora: ORA });
    assert.equal(sbagliato.ok, false);
    const giusto = codiceTotp(segretoTotp, passo(ORA + 60_000));
    assert.equal(confermaConSecondaVerifica({ utente: admin, codice: giusto, ora: ORA + 60_000 }).ok, true);
    statoVaultProcesso().conferme.clear();
    assert.equal(confermaConSecondaVerifica({ utente: admin, codice: giusto, ora: ORA + 61_000 }).ok, false);
  });

  it("codice giusto: per 5 minuti si vede senza altri codici, poi serve di nuovo", async () => {
    const t0 = ORA + 300_000;
    const c = confermaConSecondaVerifica({ utente: admin, codice: codiceTotp(segretoTotp, passo(t0)), ora: t0 });
    assert.ok(c.ok);
    assert.equal(c.ok && c.scade, t0 + DURATA_CONFERMA_MS);
    assert.equal(DURATA_CONFERMA_MS, 5 * 60_000);
    const m1 = await mostra(admin, t0 + 60_000);
    assert.ok(m1.ok);
    assert.deepEqual(m1.ok && m1.campi, { username: "admin", password: PW });
    const m2 = await mostra(admin, t0 + DURATA_CONFERMA_MS - 1);
    assert.ok(m2.ok);
    assert.equal(confermaValida(admin.id, t0 + DURATA_CONFERMA_MS + 1), null);
    const m3 = await mostra(admin, t0 + DURATA_CONFERMA_MS + 1);
    assert.equal(m3.ok ? 200 : m3.stato, 403);
  });

  it("cinque codici sbagliati di fila: 429 anche al sesto giusto", () => {
    for (let i = 0; i < 5; i++) confermaConSecondaVerifica({ utente: admin, codice: "111111", ora: ORA + 900_000 });
    const c = confermaConSecondaVerifica({ utente: admin, codice: codiceTotp(segretoTotp, passo(ORA + 900_000)), ora: ORA + 900_000 });
    assert.equal(c.ok ? 200 : c.stato, 429);
  });

  it("col vault bloccato: 423, niente valori", async () => {
    const t0 = ORA + 1_200_000;
    assert.ok(confermaConSecondaVerifica({ utente: admin, codice: codiceTotp(segretoTotp, passo(t0)), ora: t0 }).ok);
    chiudiVault("prova");
    const m = await mostra(admin, t0 + 1000);
    assert.equal(m.ok ? 200 : m.stato, 423);
  });
});

describe("registro delle visualizzazioni", () => {
  it("ogni visualizzazione è una riga con utente, voce e ora; la pagina la legge senza valori", async () => {
    const t0 = ORA + 1_500_000;
    assert.ok(confermaConSecondaVerifica({ utente: admin, codice: codiceTotp(segretoTotp, passo(t0)), ora: t0 }).ok);
    const prima = withTenant(T, () => registroVisualizzazioni(getTenantDb(T)).totale);
    await mostra(admin, t0 + 1000);
    await mostra(admin, t0 + 2000);
    const r = withTenant(T, () => registroVisualizzazioni(getTenantDb(T), { pagina: 1, perPagina: 1 }));
    assert.equal(r.totale, prima + 2);
    assert.equal(r.righe.length, 1);
    assert.equal(r.righe[0].utente, "tecnico-admin");
    assert.equal(r.righe[0].azione, "mostra");
    assert.equal(r.righe[0].credenziale, "Firewall sede");
    assert.equal(r.righe[0].credential_id, idVoce);
    assert.match(r.righe[0].created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.ok(!JSON.stringify(r).includes(PW));
  });

  it("nessun segreto nei log durante conferme e visualizzazioni", async () => {
    const righe: string[] = [];
    const orig = { info: console.info, warn: console.warn, error: console.error, log: console.log };
    for (const k of Object.keys(orig) as Array<keyof typeof orig>) console[k] = (...a: unknown[]) => { righe.push(a.map(String).join(" ")); };
    try {
      const t0 = ORA + 1_800_000;
      confermaConSecondaVerifica({ utente: admin, codice: "999999", ora: t0 });
      confermaConSecondaVerifica({ utente: admin, codice: codiceTotp(segretoTotp, passo(t0)), ora: t0 });
      await mostra(admin, t0 + 1000);
    } finally {
      Object.assign(console, orig);
    }
    const testo = righe.join("\n");
    assert.ok(!testo.includes(PW));
    assert.ok(!testo.includes(segretoTotp));
  });
});

describe("con un backend remoto acceso, i testi nominano quello vero", () => {
  const T0 = ORA + 3_600_000;
  let idConRef: number;
  const store = (backend: "openbao" | "dalink", get: () => Promise<never>) =>
    ({ backend, leggiSync: () => { throw new Error("non usato"); }, get, delete: async () => undefined, stato: () => ({ pronto: true as const, aggiornatoAlle: null }) });

  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      idConRef = creaCredenzialeDb(d, { name: "Con riferimento", credential_type: "ssh", encrypted_username: encrypt("u"), encrypted_password: encrypt("p") }).id;
      d.prepare("UPDATE credentials SET credential_ref = ? WHERE id = ?").run("clienti/vaultmostra/da-ipam/con-riferimento", idConRef);
    });
  });
  afterEach(() => {
    delete process.env.DA_VAULT_OPENBAO;
    delete process.env.DA_VAULT_DALINK;
    statoVaultProcesso().openbao = null;
    statoVaultProcesso().remotoNonAvviato = null;
  });

  const mostraRef = async () => {
    statoVaultProcesso().conferme.set(admin.id, T0 + DURATA_CONFERMA_MS);
    return withTenant(T, () => mostraVoce({ dbh: getTenantDb(T), utente: admin, credentialId: idConRef, ora: T0 }));
  };

  it("DA-Link acceso senza store: il rifiuto dice DA-Link (e il motivo dell'avvio), mai OpenBao", async () => {
    process.env.DA_VAULT_DALINK = "1";
    const m = await mostraRef();
    assert.ok(!m.ok && m.stato === 503);
    assert.ok(!m.ok && /DA-Link/.test(m.errore) && !/OpenBao/.test(m.errore), !m.ok ? m.errore : "");
    statoVaultProcesso().remotoNonAvviato = "DA_VAULT_DALINK=1 ma manca DALINK_VAULT_IMPRONTA";
    const m2 = await mostraRef();
    assert.ok(!m2.ok && /DALINK_VAULT_IMPRONTA/.test(m2.errore) && !/OpenBao/.test(m2.errore), !m2.ok ? m2.errore : "");
  });

  it("lo store che non risponde con un errore anonimo: il testo porta il nome del backend dello store", async () => {
    process.env.DA_VAULT_DALINK = "1";
    statoVaultProcesso().openbao = store("dalink", () => Promise.reject("giù"));
    const m = await mostraRef();
    assert.ok(!m.ok && m.errore === "DA-Link non ha risposto", !m.ok ? m.errore : "");
    process.env.DA_VAULT_DALINK = "";
    process.env.DA_VAULT_OPENBAO = "1";
    statoVaultProcesso().openbao = store("openbao", () => Promise.reject("giù"));
    const o = await mostraRef();
    assert.ok(!o.ok && o.errore === "OpenBao non ha risposto", !o.ok ? o.errore : "");
  });

  it("OpenBao acceso senza store: dice ancora OpenBao", async () => {
    process.env.DA_VAULT_OPENBAO = "1";
    const m = await mostraRef();
    assert.ok(!m.ok && /OpenBao/.test(m.errore) && !/DA-Link/.test(m.errore), !m.ok ? m.errore : "");
  });
});
