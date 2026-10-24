/**
 * da-vault, svuotamento delle colonne (ADR 0035): un segreto creato o cambiato dalla pagina/API (`creaVoceDb`,
 * `modificaVoceDb`) con `DA_VAULT_OPENBAO=1` va SUBITO in OpenBao, la riga prende il `credential_ref` e le sei colonne
 * cifrate restano vuote. OpenBao spento o che rifiuta = errore dichiarato (503) col motivo e niente scritto, mai un
 * ripiego sulla colonna. A interruttore spento il comportamento è quello di sempre.
 *
 * Gli incidenti (e i guasti provati): vedi i commenti di ogni prova.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/scrittura-openbao.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { decrypt, encrypt } from "@/lib/crypto";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { aggiornaCredenzialeDb, creaCredenzialeDb, creaVoceDb, eliminaVoceDb, modificaVoceDb } from "@/lib/credentials/archivio";
import { campiVoceDb, coppiaSshDb, COLONNE_SEGRETE, presenzaSegretiDb } from "@/lib/credentials/segreti";
import { mascheraCredenziale } from "@/lib/credentials/maschera";
import type { Credential } from "@/types";
import { OpenBaoStore } from "@/lib/vault/openbao";
import { statoVaultProcesso } from "@/lib/vault/stato";
import { creaOpenBaoFinto, type OpenBaoFinto } from "@/lib/vault/__tests__/support/openbao-finto";

const T = "C70031";
const CLIENTE = "c70031";
const MIN = 60_000;
let adesso = Date.parse("2026-10-24T12:00:00Z");
let finto: OpenBaoFinto;
let store: OpenBaoStore;

const db = () => getTenantDb(T);
const riga = (id: number) => db().prepare("SELECT * FROM credentials WHERE id = ?").get(id) as Record<string, unknown>;
const colonnePiene = (r: Record<string, unknown>) => COLONNE_SEGRETE.filter((c) => typeof r[c] === "string" && r[c] !== "");
const scritture = () => finto.richieste.filter((q) => q.metodo === "POST" && q.percorso.includes("/data/"));

before(() => {
  withTenant(T, () => db());
});

beforeEach(async () => {
  adesso = Date.parse("2026-10-24T12:00:00Z");
  finto = creaOpenBaoFinto({ ora: () => adesso });
  store = new OpenBaoStore({
    url: finto.url,
    roleId: finto.roleId,
    secretId: () => finto.secretId,
    cartelle: [],
    percorsiExtra: () => [...finto.kv.keys()],
    fetch: finto.fetch,
    fetchSync: finto.fetchSync,
    ora: () => adesso,
    durataCacheMs: 30 * MIN,
  });
  await store.aggiorna();
  statoVaultProcesso().openbao = store;
  statoVaultProcesso().doppiaLetturaSegnalata.clear();
  process.env.DA_VAULT_OPENBAO = "1";
  withTenant(T, () => db().prepare("DELETE FROM credentials").run());
});

after(() => {
  delete process.env.DA_VAULT_OPENBAO;
  statoVaultProcesso().openbao = null;
  try {
    closeTenantDb(T);
    deleteTenantDatabase(T);
  } catch {
    /* già tolto */
  }
  closeHubDb();
});

const NUOVA = { name: "Firewall Sede", credential_type: "ssh" as const, username: "admin", password: "pw-segreta-91", port: 22 };

describe("interruttore spento: il comportamento di sempre", () => {
  // Se l'interruttore spento cambiasse comportamento, le appliance dei clienti (backend locale) non avrebbero più i segreti
  // nelle colonne cifrate con la loro chiave, o parlerebbero con un OpenBao che non c'è.
  beforeEach(() => {
    delete process.env.DA_VAULT_OPENBAO;
  });

  it("crea: le colonne cifrate, nessun riferimento, nessuna richiesta a OpenBao, vista invariata", () => {
    const e = withTenant(T, () => creaVoceDb(db(), NUOVA));
    assert.ok(e.ok);
    const r = riga(e.vista.id);
    assert.equal(decrypt(String(r.encrypted_password)), "pw-segreta-91");
    assert.equal(decrypt(String(r.encrypted_username)), "admin");
    assert.equal(r.credential_ref ?? null, null);
    assert.equal(finto.richieste.length, 0, "nessuna richiesta a OpenBao");
    assert.equal(e.vista.ha_password, true);
    assert.equal(e.vista.ha_username, true);
    assert.ok(!("segreti_non_leggibili" in e.vista), "la vista non porta chiavi in più");
  });

  it("modifica: la password nuova va nella colonna cifrata, il riferimento (di una migrazione fatta prima) non si tocca", () => {
    const c = withTenant(T, () => creaCredenzialeDb(db(), { name: "Router", credential_type: "ssh", encrypted_username: encrypt("root"), encrypted_password: encrypt("vecchia"), credential_ref: `clienti/${CLIENTE}/da-ipam/router-1` }));
    const e = withTenant(T, () => modificaVoceDb(db(), c.id, { password: "nuova-pw" }, {}));
    assert.ok(e.ok);
    const r = riga(c.id);
    assert.equal(decrypt(String(r.encrypted_password)), "nuova-pw");
    assert.equal(r.credential_ref, `clienti/${CLIENTE}/da-ipam/router-1`, "spento, il riferimento non conta e resta com'è");
    assert.equal(finto.richieste.length, 0);
  });
});

describe("crea con OpenBao acceso", () => {
  it("il segreto va in OpenBao al percorso della migrazione, la riga prende il riferimento, le colonne restano vuote", () => {
    const e = withTenant(T, () => creaVoceDb(db(), NUOVA));
    assert.ok(e.ok);
    assert.equal(e.stato, 201);
    const r = riga(e.vista.id);
    const percorso = `clienti/${CLIENTE}/da-ipam/firewall-sede-${e.vista.id}`;
    assert.equal(r.credential_ref, percorso);
    assert.deepEqual(finto.kv.get(percorso), { username: "admin", password: "pw-segreta-91" });
    assert.deepEqual(colonnePiene(r), [], "nessuna colonna segreta con un valore");
    // la vista dice che i segreti ci sono, senza averli nelle colonne
    assert.equal(e.vista.ha_username, true);
    assert.equal(e.vista.ha_password, true);
    assert.equal(e.vista.ha_chiave_privata, false);
    // e il lettore unico li trova subito (la cache vede la scrittura, senza aspettare il giro)
    assert.deepEqual(withTenant(T, () => coppiaSshDb(db(), e.vista.id)), { username: "admin", password: "pw-segreta-91", port: 22 });
  });

  it("chiave SSH e passphrase, SNMPv3: tutti i campi vanno in OpenBao", () => {
    const k = withTenant(T, () => creaVoceDb(db(), { name: "Linux a chiave", credential_type: "ssh", auth_method: "chiave", username: "root", private_key: "-----KEY-----", passphrase: "frase" }));
    assert.ok(k.ok);
    assert.deepEqual(finto.kv.get(`clienti/${CLIENTE}/da-ipam/linux-a-chiave-${k.vista.id}`), { username: "root", private_key: "-----KEY-----", key_passphrase: "frase" });
    const v3 = withTenant(T, () =>
      creaVoceDb(db(), { name: "Switch v3", credential_type: "snmp_v3", username: "mon", security_level: "authPriv", auth_protocol: "SHA", auth_key: "auth-k", priv_protocol: "AES", priv_key: "priv-k" }),
    );
    assert.ok(v3.ok);
    assert.deepEqual(finto.kv.get(`clienti/${CLIENTE}/da-ipam/switch-v3-${v3.vista.id}`), { username: "mon", auth_key: "auth-k", priv_key: "priv-k" });
    assert.deepEqual(colonnePiene(riga(v3.vista.id)), []);
  });

  it("OpenBao spento: 503 col motivo, nessuna riga rimasta, nessun valore in nessuna colonna (mai il ripiego)", () => {
    // Guasto provato: se creaVoceDb ripiegasse sulla colonna quando OpenBao non risponde, qui resterebbe una riga con la
    // password cifrata e il lettore la darebbe per buona.
    finto.giu = true;
    const e = withTenant(T, () => creaVoceDb(db(), NUOVA));
    assert.equal(e.ok, false);
    assert.equal(e.ok ? 0 : e.stato, 503);
    assert.match(e.ok ? "" : e.errore, /Firewall Sede.*non è stata salvata.*OpenBao non risponde/);
    assert.equal((db().prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n, 0);
    assert.ok(!JSON.stringify(e).includes("pw-segreta-91"));
  });

  it("OpenBao rifiuta la scrittura (policy senza create): 503 con lo stato di OpenBao, niente salvato", () => {
    finto.rifiutaScritture = 403;
    const e = withTenant(T, () => creaVoceDb(db(), NUOVA));
    assert.equal(e.ok, false);
    assert.equal(e.ok ? 0 : e.stato, 503);
    assert.match(e.ok ? "" : e.errore, /rifiutato la scrittura.*HTTP 403/);
    assert.equal((db().prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n, 0);
    assert.equal(finto.kv.size, 0);
  });

  it("OpenBao non configurato (interruttore acceso, niente store): 503 che lo dice", () => {
    statoVaultProcesso().openbao = null;
    const e = withTenant(T, () => creaVoceDb(db(), NUOVA));
    assert.equal(e.ok, false);
    assert.match(e.ok ? "" : e.errore, /non è configurato/);
    assert.equal((db().prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n, 0);
  });

  it("i campi richiesti si controllano come sempre, prima di scrivere", () => {
    const e = withTenant(T, () => creaVoceDb(db(), { name: "Senza password", credential_type: "ssh", username: "admin" }));
    assert.equal(e.ok, false);
    assert.equal(e.ok ? 0 : e.stato, 400);
    assert.equal(finto.richieste.length, 0, "niente a OpenBao per una richiesta sbagliata");
  });
});

describe("modifica con OpenBao acceso", () => {
  function conRiferimento(): { id: number; percorso: string } {
    const id = withTenant(T, () => creaVoceDb(db(), NUOVA));
    assert.ok(id.ok);
    return { id: id.vista.id, percorso: `clienti/${CLIENTE}/da-ipam/firewall-sede-${id.vista.id}` };
  }

  it("una password nuova riscrive il segreto allo stesso percorso e tiene l'utente; le colonne restano vuote", () => {
    const { id, percorso } = conRiferimento();
    const e = withTenant(T, () => modificaVoceDb(db(), id, { password: "nuova-pw-22" }, {}));
    assert.ok(e.ok);
    assert.deepEqual(finto.kv.get(percorso), { username: "admin", password: "nuova-pw-22" });
    const r = riga(id);
    assert.equal(r.credential_ref, percorso);
    assert.deepEqual(colonnePiene(r), []);
    assert.equal(e.vista.ha_password, true);
  });

  it("solo il nome: nessuna scrittura in OpenBao, e i campi richiesti passano nonostante le colonne vuote", () => {
    // Guasto provato: se `controlla` guardasse le colonne (vuote), qualunque modifica di una voce migrata sarebbe un 400
    // «Campo obbligatorio mancante».
    const { id } = conRiferimento();
    const prima = scritture().length;
    const e = withTenant(T, () => modificaVoceDb(db(), id, { name: "Firewall Sede (rinominato)" }, {}));
    assert.ok(e.ok, e.ok ? "" : e.errore);
    assert.equal(e.vista.name, "Firewall Sede (rinominato)");
    assert.equal(scritture().length, prima, "nessuna nuova scrittura");
    assert.equal(e.vista.ha_password, true, "la vista legge da OpenBao");
    assert.deepEqual(colonnePiene(riga(id)), []);
  });

  it("la pagina rimanda lo stesso utente (precompilato): nessuna versione nuova in OpenBao", () => {
    const { id } = conRiferimento();
    const prima = scritture().length;
    const e = withTenant(T, () => modificaVoceDb(db(), id, { username: "admin" }, {}));
    assert.ok(e.ok);
    assert.equal(scritture().length, prima);
  });

  it("l'utente cambiato va in OpenBao e la password resta quella", () => {
    const { id, percorso } = conRiferimento();
    const e = withTenant(T, () => modificaVoceDb(db(), id, { username: "root" }, {}));
    assert.ok(e.ok);
    assert.deepEqual(finto.kv.get(percorso), { username: "root", password: "pw-segreta-91" });
  });

  it("OpenBao spento: 503, il segreto e la riga restano com'erano (anche il nome)", () => {
    const { id, percorso } = conRiferimento();
    finto.giu = true;
    const e = withTenant(T, () => modificaVoceDb(db(), id, { name: "Altro nome", password: "nuova" }, {}));
    assert.equal(e.ok, false);
    assert.equal(e.ok ? 0 : e.stato, 503);
    assert.match(e.ok ? "" : e.errore, /Firewall Sede/);
    finto.giu = false;
    assert.deepEqual(finto.kv.get(percorso), { username: "admin", password: "pw-segreta-91" });
    assert.equal(riga(id).name, "Firewall Sede");
    assert.deepEqual(colonnePiene(riga(id)), []);
  });

  it("OpenBao rifiuta la scrittura: 503 e il segreto vecchio resta", () => {
    const { id, percorso } = conRiferimento();
    finto.rifiutaScritture = 403;
    const e = withTenant(T, () => modificaVoceDb(db(), id, { password: "nuova" }, {}));
    assert.equal(e.ok, false);
    assert.equal(e.ok ? 0 : e.stato, 503);
    assert.deepEqual(finto.kv.get(percorso), { username: "admin", password: "pw-segreta-91" });
  });

  it("una voce non ancora migrata (colonne piene, nessun riferimento): la modifica la porta in OpenBao intera", () => {
    const c = withTenant(T, () =>
      creaCredenzialeDb(db(), { name: "Router vecchio", credential_type: "ssh", encrypted_username: encrypt("root"), encrypted_password: encrypt("pw-colonna") }),
    );
    const e = withTenant(T, () => modificaVoceDb(db(), c.id, { password: "pw-nuova" }, {}));
    assert.ok(e.ok);
    const percorso = `clienti/${CLIENTE}/da-ipam/router-vecchio-${c.id}`;
    // l'utente, che la richiesta non portava, viene dalla colonna decifrata: non si perde
    assert.deepEqual(finto.kv.get(percorso), { username: "root", password: "pw-nuova" });
    const r = riga(c.id);
    assert.equal(r.credential_ref, percorso);
    assert.deepEqual(colonnePiene(r), []);
  });

  it("una voce non migrata con la colonna che non si decifra: 503 che lo dice, niente toccato", () => {
    const c = withTenant(T, () => creaCredenzialeDb(db(), { name: "Rotta", credential_type: "ssh", encrypted_username: encrypt("root"), encrypted_password: `${"a".repeat(32)}:${"b".repeat(32)}:abcd` }));
    const e = withTenant(T, () => modificaVoceDb(db(), c.id, { name: "Rotta 2" }, {}));
    assert.equal(e.ok, false);
    assert.equal(e.ok ? 0 : e.stato, 503);
    assert.match(e.ok ? "" : e.errore, /non si decifra/);
    assert.equal(riga(c.id).name, "Rotta");
  });

  it("senza modificare segreti, una voce non migrata resta com'è (le colonne si migrano al primo segreto cambiato)", () => {
    const c = withTenant(T, () =>
      creaCredenzialeDb(db(), { name: "Router vecchio", credential_type: "ssh", encrypted_username: encrypt("root"), encrypted_password: encrypt("pw-colonna") }),
    );
    const e = withTenant(T, () => modificaVoceDb(db(), c.id, { name: "Router" }, {}));
    assert.ok(e.ok);
    assert.equal(decrypt(String(riga(c.id).encrypted_password)), "pw-colonna");
    assert.equal(riga(c.id).credential_ref ?? null, null);
    assert.equal(finto.richieste.length === 0 || scritture().length === 0, true);
  });

  it("cambio di forma (da password a chiave): il campo che non vale più sparisce anche da OpenBao", () => {
    const { id, percorso } = conRiferimento();
    const e = withTenant(T, () => modificaVoceDb(db(), id, { auth_method: "chiave", private_key: "-----K-----" }, {}));
    assert.ok(e.ok, e.ok ? "" : e.errore);
    assert.deepEqual(finto.kv.get(percorso), { username: "admin", private_key: "-----K-----" });
  });
});

describe("la cancellazione e la lettura dopo la scrittura", () => {
  it("elimina: il segreto sparisce da OpenBao (come prima) e non resta niente nelle colonne", async () => {
    const e = withTenant(T, () => creaVoceDb(db(), NUOVA));
    assert.ok(e.ok);
    const percorso = `clienti/${CLIENTE}/da-ipam/firewall-sede-${e.vista.id}`;
    assert.ok(finto.kv.has(percorso));
    withTenant(T, () => eliminaVoceDb(db(), e.vista.id));
    const { attendiCancellazioniOpenBao } = await import("@/lib/vault/cancella");
    await attendiCancellazioniOpenBao();
    assert.equal(finto.kv.has(percorso), false);
  });

  it("un giro della cache che ha già letto il valore vecchio non lo rimette al posto del nuovo", async () => {
    // Guasto provato: il giro legge OpenBao, la scrittura sincrona arriva mentre la risposta è in viaggio, e poi il giro
    // mette la sua cache (col valore vecchio) al posto della vecchia: senza il registro delle scritture la modifica
    // sparirebbe dalle letture dell'app fino al giro dopo (5 minuti), e il segreto cambiato parrebbe ancora quello di prima.
    const e = withTenant(T, () => creaVoceDb(db(), NUOVA));
    assert.ok(e.ok);
    const percorso = `clienti/${CLIENTE}/da-ipam/firewall-sede-${e.vista.id}`;
    let letto!: () => void;
    const dopoLaLettura = new Promise<void>((ok) => { letto = ok; });
    let apri!: () => void;
    const cancello = new Promise<void>((ok) => { apri = ok; });
    let ritarda = false;
    const fetchLento: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = await finto.fetch(input, init); // il finto risponde SUBITO col valore di quel momento
      if (ritarda && String(input).endsWith(`/data/${percorso}`) && (init?.method ?? "GET") === "GET") {
        letto();
        await cancello; // ... ma la risposta arriva al giro solo dopo la scrittura
      }
      return r;
    }) as typeof fetch;
    const s2 = new OpenBaoStore({
      url: finto.url, roleId: finto.roleId, secretId: () => finto.secretId, cartelle: [], percorsiExtra: () => [percorso],
      fetch: fetchLento, fetchSync: finto.fetchSync, ora: () => adesso,
    });
    await s2.aggiorna(); // la cache caricata, col token
    ritarda = true;
    const giro = s2.aggiorna();
    await dopoLaLettura; // il giro ha letto il valore VECCHIO
    s2.putSync(percorso, { username: "admin", password: "pw-nuova-durante-il-giro" });
    apri();
    await giro;
    assert.equal(s2.leggiSync(percorso).password, "pw-nuova-durante-il-giro");
  });
});

describe("il guardiano: mai un valore in chiaro in una colonna con OpenBao acceso", () => {
  it("creaCredenzialeDb e aggiornaCredenzialeDb rifiutano un valore in chiaro; il cifrato passa; il messaggio non porta il valore", () => {
    // Guasto provato: una strada che dimenticasse di passare dallo scrittore metterebbe la password in chiaro nel
    // database senza che nessuna prova se ne accorga.
    let messaggio = "";
    try {
      withTenant(T, () => creaCredenzialeDb(db(), { name: "X", credential_type: "ssh", encrypted_password: "password-in-chiaro" }));
    } catch (e) {
      messaggio = (e as Error).message;
    }
    assert.match(messaggio, /in chiaro.*encrypted_password/);
    assert.ok(!messaggio.includes("password-in-chiaro"));
    const c = withTenant(T, () => creaCredenzialeDb(db(), { name: "Y", credential_type: "ssh", encrypted_password: encrypt("ok") }));
    assert.throws(() => withTenant(T, () => aggiornaCredenzialeDb(db(), c.id, { encrypted_username: "admin" })), /in chiaro.*encrypted_username/);
    assert.equal(decrypt(String(riga(c.id).encrypted_password)), "ok");
    assert.equal(riga(c.id).encrypted_username ?? null, null);
  });

  it("spento, il guardiano non c'è: il codice di sempre", () => {
    delete process.env.DA_VAULT_OPENBAO;
    const c = withTenant(T, () => creaCredenzialeDb(db(), { name: "Spento", credential_type: "ssh", encrypted_password: "qualunque" }));
    assert.equal(riga(c.id).encrypted_password, "qualunque");
  });
});

describe("la maschera con le colonne vuote", () => {
  it("la presenza dei segreti viene da OpenBao; oltre la cache dice perché non lo sa, senza ripiegare", () => {
    const e = withTenant(T, () => creaVoceDb(db(), NUOVA));
    assert.ok(e.ok);
    const voce = riga(e.vista.id) as unknown as Credential;
    const p = presenzaSegretiDb(db(), voce);
    assert.ok(p.ok);
    const v = mascheraCredenziale(voce, 0, p);
    assert.equal(v.ha_password, true);
    assert.equal(v.ha_username, true);
    // OpenBao non risponde da oltre la durata della cache: i sei «ha_…» sono falsi e il motivo è dichiarato
    finto.giu = true;
    adesso += 31 * MIN;
    const p2 = presenzaSegretiDb(db(), voce);
    assert.equal(p2.ok, false);
    const v2 = mascheraCredenziale(voce, 0, p2);
    assert.equal(v2.ha_password, false);
    assert.match(v2.segreti_non_leggibili ?? "", /OpenBao non risponde/);
  });
});
