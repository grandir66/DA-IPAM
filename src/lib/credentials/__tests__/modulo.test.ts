/**
 * Il modulo «Nuova / Modifica credenziale» senza la parte visiva (tappa 4
 * credenziali, 15/10; tipi per esteso della tappa 2, T13, 16/10).
 *
 * Perché: il wizard chiedeva le credenziali con quattro blocchi fissi suoi
 * (SNMP, SSH, Windows, Linux) e il router con utente e password in linea, e
 * la stessa voce si scriveva due volte. Ora il wizard usa lo stesso modulo
 * della pagina Credenziali.
 *
 * Dalla T13 il modulo copre gli otto tipi d'archivio: un «Metodo» per i tipi
 * che ne hanno due, i campi di quel metodo (da `tipi.ts`, gli stessi che il
 * server richiede), SNMP v3 come tipo a sé. La voce arriva dalla GET già
 * mascherata (`CredenzialeVista`): dei segreti si sa solo se ci sono.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/modulo.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  statoNuovo,
  statoModifica,
  erroreModulo,
  richiestaSalvataggio,
  segnapostoPorta,
  opzioniConTipoAttuale,
  serveUtenteInModifica,
  campiDelModulo,
  metodiDelTipo,
  segretoGiaImpostato,
  etichetteCampi,
  type StatoModulo,
  type VoceArchivio,
} from "../modulo";

function voce(parziale: Partial<VoceArchivio>): VoceArchivio {
  return {
    id: 5,
    name: "Admin MikroTik",
    credential_type: "ssh",
    etichetta: "SSH (password o chiave)",
    auth_method: null,
    port: null,
    security_level: null,
    auth_protocol: null,
    priv_protocol: null,
    ha_username: true,
    ha_password: true,
    ha_chiave_privata: false,
    ha_passphrase: false,
    ha_auth_key: false,
    ha_priv_key: false,
    usi_totale: 0,
    created_at: "2026-10-15 08:00:00",
    updated_at: "2026-10-15 08:00:00",
    ...parziale,
  };
}

function nuovo(campi: Partial<StatoModulo["form"]>): StatoModulo {
  const s = statoNuovo();
  return { ...s, form: { ...s.form, ...campi } };
}

const corpo = (s: StatoModulo) => JSON.parse(JSON.stringify(richiestaSalvataggio(s).body)) as Record<string, unknown>;

describe("stato iniziale", () => {
  it("nuova voce: SSH, tutto vuoto, nessun segreto già salvato", () => {
    const s = statoNuovo();
    assert.equal(s.editingId, null);
    assert.equal(s.form.credential_type, "ssh");
    assert.equal(s.form.auth_method, "");
    assert.equal(s.form.name, "");
    assert.equal(s.form.port, "");
    assert.equal(s.salvata, null);
    assert.equal(segretoGiaImpostato(s, "password"), false);
  });

  it("nuova voce con un tipo di partenza; la SNMP v3 parte da authPriv", () => {
    assert.equal(statoNuovo("snmp").form.credential_type, "snmp");
    assert.equal(statoNuovo("snmp").form.security_level, "");
    assert.equal(statoNuovo("snmp_v3").form.security_level, "authPriv");
  });

  it("modifica: dalla vista mascherata; segreti mai precompilati, solo «già impostato»", () => {
    const s = statoModifica(
      voce({ credential_type: "snmp_v3", security_level: "authPriv", auth_protocol: "SHA", priv_protocol: "AES", ha_password: false, ha_auth_key: true, ha_priv_key: true, port: 1161 }),
      "monitor",
    );
    assert.equal(s.editingId, 5);
    assert.equal(s.form.credential_type, "snmp_v3");
    assert.equal(s.form.username, "monitor");
    assert.equal(s.form.security_level, "authPriv");
    assert.equal(s.form.auth_protocol, "SHA");
    assert.equal(s.form.priv_protocol, "AES");
    assert.equal(s.form.auth_key, "");
    assert.equal(s.form.priv_key, "");
    assert.equal(s.form.port, "1161");
    assert.equal(segretoGiaImpostato(s, "auth_key"), true);
    assert.equal(segretoGiaImpostato(s, "priv_key"), true);
    assert.equal(segretoGiaImpostato(s, "password"), false);
  });

  it("modifica: porta assente = campo vuoto (porta standard); metodo salvato nel modulo", () => {
    assert.equal(statoModifica(voce({ port: null }), "admin").form.port, "");
    assert.equal(statoModifica(voce({ auth_method: "chiave", ha_password: false, ha_chiave_privata: true }), "root").form.auth_method, "chiave");
  });

  it("lo username si chiede al server solo se la voce ne ha uno", () => {
    assert.equal(serveUtenteInModifica(voce({ ha_username: true })), true);
    assert.equal(serveUtenteInModifica(voce({ credential_type: "snmp", ha_username: false })), false);
  });

  it("cambiando tipo o metodo i segreti salvati non valgono più (il server li svuota)", () => {
    const s = statoModifica(voce({}), "admin");
    assert.equal(segretoGiaImpostato(s, "password"), true);
    // SSH → Windows: stessa forma (utente e password), la password resta.
    assert.equal(segretoGiaImpostato({ ...s, form: { ...s.form, credential_type: "windows" } }, "password"), true);
    // SSH password → chiave: la password vecchia non è più quel segreto.
    assert.equal(segretoGiaImpostato({ ...s, form: { ...s.form, auth_method: "chiave" } }, "password"), false);
  });
});

describe("campi per tipo e metodo (gli stessi di tipi.ts)", () => {
  it("il «Metodo» si sceglie solo per i tipi che ne hanno due", () => {
    assert.deepEqual(metodiDelTipo("ssh").map((m) => m.value), ["password", "chiave"]);
    assert.deepEqual(metodiDelTipo("api").map((m) => m.value), ["utente", "token"]);
    assert.deepEqual(metodiDelTipo("unifi").map((m) => m.value), ["chiave", "utente"]);
    assert.deepEqual(metodiDelTipo("omada").map((m) => m.value), ["client", "utente"]);
    for (const t of ["snmp", "snmp_v3", "windows", "ad"]) assert.deepEqual(metodiDelTipo(t), [], t);
  });

  it("i campi del modulo seguono il metodo", () => {
    assert.deepEqual(campiDelModulo(nuovo({})), ["username", "password"]);
    assert.deepEqual(campiDelModulo(nuovo({ auth_method: "chiave" })), ["username", "private_key", "passphrase"]);
    assert.deepEqual(campiDelModulo(nuovo({ credential_type: "snmp" })), ["password"]);
    assert.deepEqual(campiDelModulo(nuovo({ credential_type: "snmp_v3" })), ["username", "v3", "auth_key", "priv_key"]);
    assert.deepEqual(campiDelModulo(nuovo({ credential_type: "unifi" })), ["password"]);
    assert.deepEqual(campiDelModulo(nuovo({ credential_type: "omada" })), ["username", "password"]);
  });

  it("le etichette dicono che cosa va nel campo", () => {
    assert.deepEqual(etichetteCampi("snmp", "community"), { username: "Username", password: "Community" });
    assert.deepEqual(etichetteCampi("unifi", "chiave"), { username: "Username", password: "Chiave API" });
    assert.deepEqual(etichetteCampi("omada", "client"), { username: "Client ID", password: "Client secret" });
    assert.deepEqual(etichetteCampi("api", "token"), { username: "ID del token (facoltativo)", password: "Token" });
  });
});

describe("controlli prima del salvataggio", () => {
  it("nome vuoto", () => {
    assert.equal(erroreModulo(nuovo({ name: "  " })), "Nome richiesto");
  });

  it("SSH nuova senza password; in modifica la password vuota = non modificare, lo username resta obbligatorio", () => {
    assert.equal(erroreModulo(nuovo({ name: "x", username: "admin" })), "Password richiesta");
    assert.equal(erroreModulo(nuovo({ name: "x", password: "p" })), "Username richiesto");
    const base = statoModifica(voce({}), "admin");
    assert.equal(erroreModulo(base), null);
    assert.equal(erroreModulo({ ...base, form: { ...base.form, username: "" } }), "Username richiesto");
  });

  it("SSH a chiave: la chiave privata è obbligatoria, la passphrase no", () => {
    assert.equal(erroreModulo(nuovo({ name: "x", auth_method: "chiave", username: "root" })), "Chiave privata richiesta");
    assert.equal(erroreModulo(nuovo({ name: "x", auth_method: "chiave", username: "root", private_key: "K" })), null);
    // In modifica, passando da password a chiave, la chiave va data.
    const s = statoModifica(voce({}), "root");
    assert.equal(erroreModulo({ ...s, form: { ...s.form, auth_method: "chiave" } }), "Chiave privata richiesta");
  });

  it("UniFi con chiave API, Omada con client, API con token", () => {
    assert.equal(erroreModulo(nuovo({ name: "x", credential_type: "unifi" })), "Chiave API richiesta");
    assert.equal(erroreModulo(nuovo({ name: "x", credential_type: "unifi", password: "k" })), null);
    assert.equal(erroreModulo(nuovo({ name: "x", credential_type: "omada", password: "s" })), "Client ID richiesto");
    assert.equal(erroreModulo(nuovo({ name: "x", credential_type: "api", auth_method: "token" })), "Token richiesto");
    assert.equal(erroreModulo(nuovo({ name: "x", credential_type: "api", auth_method: "token", password: "t" })), null);
  });

  it("SNMP v1/v2c nuova senza community", () => {
    assert.equal(erroreModulo(nuovo({ name: "x", credential_type: "snmp" })), "Community string richiesta");
    assert.equal(erroreModulo(nuovo({ name: "x", credential_type: "snmp", password: "public" })), null);
  });

  it("porta fuori intervallo", () => {
    assert.equal(erroreModulo(nuovo({ name: "x", username: "u", password: "p", port: "70000" })), "Porta fra 1 e 65535, oppure vuota per la porta standard");
    assert.equal(erroreModulo(nuovo({ name: "x", username: "u", password: "p", port: "0" })), "Porta fra 1 e 65535, oppure vuota per la porta standard");
  });

  it("SNMP v3: protocolli e chiavi secondo il livello", () => {
    const v3 = (f: Partial<StatoModulo["form"]>) => nuovo({ name: "x", credential_type: "snmp_v3", username: "m", ...f });
    assert.equal(erroreModulo(v3({ security_level: "noAuthNoPriv" })), null);
    assert.equal(erroreModulo(v3({ security_level: "authNoPriv" })), "Protocollo di autenticazione SNMPv3 richiesto");
    assert.equal(erroreModulo(v3({ security_level: "authNoPriv", auth_protocol: "SHA" })), "Chiave di autenticazione SNMPv3 richiesta");
    assert.equal(erroreModulo(v3({ security_level: "authNoPriv", auth_protocol: "SHA", auth_key: "k" })), null);
    assert.equal(erroreModulo(v3({ security_level: "authPriv", auth_protocol: "SHA", auth_key: "k" })), "Protocollo di privacy SNMPv3 richiesto");
    assert.equal(
      erroreModulo(v3({ security_level: "authPriv", auth_protocol: "SHA", auth_key: "k", priv_protocol: "AES" })),
      "Chiave di privacy SNMPv3 richiesta",
    );
    assert.equal(erroreModulo(v3({ security_level: "" })), "Livello di sicurezza SNMPv3 richiesto");
    assert.equal(erroreModulo(v3({ username: "", security_level: "noAuthNoPriv" })), "Username SNMPv3 richiesto");
  });

  it("SNMP v3 in modifica: le chiavi già impostate non si richiedono", () => {
    const s = statoModifica(
      voce({ credential_type: "snmp_v3", security_level: "authPriv", auth_protocol: "SHA", priv_protocol: "AES", ha_password: false, ha_auth_key: true, ha_priv_key: true }),
      "m",
    );
    assert.equal(erroreModulo(s), null);
  });

  it("un tipo sconosciuto non si salva", () => {
    assert.equal(erroreModulo(nuovo({ name: "x", credential_type: "telnet" })), "Scegli il tipo della credenziale");
  });
});

describe("richiesta di salvataggio", () => {
  it("nuova SSH: POST con utente e password, porta assente se vuota", () => {
    const r = richiestaSalvataggio(nuovo({ name: "Router", username: "admin", password: "segreta" }));
    assert.equal(r.url, "/api/credentials");
    assert.equal(r.method, "POST");
    assert.deepEqual(corpo(nuovo({ name: "Router", username: "admin", password: "segreta" })), {
      name: "Router",
      credential_type: "ssh",
      auth_method: "password",
      username: "admin",
      password: "segreta",
    });
  });

  it("nuova con porta propria", () => {
    assert.equal(corpo(nuovo({ name: "R", username: "a", password: "p", port: "2222" })).port, 2222);
  });

  it("solo i campi del metodo: una SSH a chiave non manda la password scritta prima", () => {
    assert.deepEqual(corpo(nuovo({ name: "K", auth_method: "chiave", username: "root", password: "vecchia", private_key: "K", passphrase: "f" })), {
      name: "K",
      credential_type: "ssh",
      auth_method: "chiave",
      username: "root",
      private_key: "K",
      passphrase: "f",
    });
  });

  it("modifica: PUT sulla voce; segreti vuoti non si mandano; porta vuota = null (torna allo standard)", () => {
    const s = statoModifica(voce({ port: 2222 }), "admin");
    const r = richiestaSalvataggio(s);
    assert.equal(r.url, "/api/credentials/5");
    assert.equal(r.method, "PUT");
    assert.deepEqual(corpo(s), { name: "Admin MikroTik", credential_type: "ssh", auth_method: "password", username: "admin", port: 2222 });
    assert.equal(corpo({ ...s, form: { ...s.form, port: "" } }).port, null);
  });

  it("SNMP v3: livello e protocolli, le chiavi vuote non si mandano, niente community", () => {
    assert.deepEqual(corpo(nuovo({ name: "v3", credential_type: "snmp_v3", username: "m", security_level: "authNoPriv", auth_protocol: "SHA", auth_key: "k", password: "public" })), {
      name: "v3",
      credential_type: "snmp_v3",
      username: "m",
      security_level: "authNoPriv",
      auth_protocol: "SHA",
      auth_key: "k",
      priv_protocol: null,
    });
  });

  it("SNMP v1/v2c: solo la community, niente campi v3", () => {
    assert.deepEqual(corpo(nuovo({ name: "c", credential_type: "snmp", username: "m", password: "public", security_level: "authPriv" })), {
      name: "c",
      credential_type: "snmp",
      password: "public",
    });
  });

  it("UniFi, AD: niente porta (non sono accessi a un apparato)", () => {
    assert.equal("port" in corpo(nuovo({ name: "u", credential_type: "unifi", password: "k", port: "8443" })), false);
    assert.equal("port" in corpo(nuovo({ name: "a", credential_type: "ad", username: "u", password: "p" })), false);
  });
});

describe("tendina del tipo", () => {
  it("segnaposto della porta: lo standard del tipo, o solo «standard» se non lo si conosce", () => {
    assert.equal(segnapostoPorta("ssh"), "standard (22)");
    assert.equal(segnapostoPorta("linux"), "standard (22)");
    assert.equal(segnapostoPorta("snmp"), "standard (161)");
    assert.equal(segnapostoPorta("snmp_v3"), "standard (161)");
    assert.equal(segnapostoPorta("windows"), "standard (5985)");
    assert.equal(segnapostoPorta("api"), "standard (443)");
    assert.equal(segnapostoPorta("unifi"), "standard");
  });

  it("una voce di un tipo fuori dalle opzioni resta visibile in modifica, con l'etichetta per esteso", () => {
    const opzioni = [{ value: "ssh", label: "SSH (password o chiave)" }];
    assert.deepEqual(opzioniConTipoAttuale(opzioni, "ssh"), opzioni);
    assert.deepEqual(opzioniConTipoAttuale(opzioni, "ad"), [...opzioni, { value: "ad", label: "Active Directory" }]);
  });
});
