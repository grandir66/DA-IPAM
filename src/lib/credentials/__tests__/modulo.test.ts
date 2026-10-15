/**
 * Il modulo «Nuova / Modifica credenziale» senza la parte visiva (tappa 4
 * credenziali, 15/10).
 *
 * Perché: il wizard chiedeva le credenziali con quattro blocchi fissi suoi
 * (SNMP, SSH, Windows, Linux) e il router con utente e password in linea, e
 * la stessa voce si scriveva due volte. Ora il wizard usa lo stesso modulo
 * della pagina Credenziali: queste prove fissano i controlli e i corpi delle
 * richieste com'erano nella pagina, così l'estrazione non ne cambia il
 * comportamento.
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
  type StatoModulo,
  type VoceArchivio,
} from "../modulo";

function voce(parziale: Partial<VoceArchivio>): VoceArchivio {
  return {
    id: 5,
    name: "Admin MikroTik",
    credential_type: "ssh",
    encrypted_username: "●●●●●●●●",
    encrypted_password: "●●●●●●●●",
    encrypted_auth_key: null,
    auth_protocol: null,
    encrypted_priv_key: null,
    priv_protocol: null,
    security_level: null,
    port: null,
    created_at: "2026-10-15 08:00:00",
    updated_at: "2026-10-15 08:00:00",
    ...parziale,
  };
}

function nuovo(campi: Partial<StatoModulo["form"]>): StatoModulo {
  const s = statoNuovo();
  return { ...s, form: { ...s.form, ...campi } };
}

describe("stato iniziale", () => {
  it("nuova voce: SSH, tutto vuoto, nessuna chiave SNMPv3 già impostata", () => {
    const s = statoNuovo();
    assert.equal(s.editingId, null);
    assert.equal(s.form.credential_type, "ssh");
    assert.equal(s.form.name, "");
    assert.equal(s.form.port, "");
    assert.equal(s.existingAuthKey, false);
    assert.equal(s.existingPrivKey, false);
  });

  it("nuova voce con un tipo di partenza (il «+ nuova» del router SNMP)", () => {
    assert.equal(statoNuovo("snmp").form.credential_type, "snmp");
  });

  it("modifica: nome, tipo, porta e livello v3 dalla voce; chiavi sempre vuote, solo l'indicatore", () => {
    const s = statoModifica(
      voce({ credential_type: "snmp", security_level: "authPriv", auth_protocol: "SHA", priv_protocol: "AES", encrypted_auth_key: "●●●●●●●●", encrypted_priv_key: "●●●●●●●●", port: 1161 }),
      "monitor",
    );
    assert.equal(s.editingId, 5);
    assert.equal(s.form.credential_type, "snmp");
    assert.equal(s.form.username, "monitor");
    assert.equal(s.form.security_level, "authPriv");
    assert.equal(s.form.auth_protocol, "SHA");
    assert.equal(s.form.priv_protocol, "AES");
    assert.equal(s.form.auth_key, "");
    assert.equal(s.form.priv_key, "");
    assert.equal(s.form.password, "");
    assert.equal(s.form.port, "1161");
    assert.equal(s.existingAuthKey, true);
    assert.equal(s.existingPrivKey, true);
  });

  it("modifica: porta assente = campo vuoto (porta standard)", () => {
    assert.equal(statoModifica(voce({ port: null }), "admin").form.port, "");
  });

  it("lo username si chiede al server solo dove il modulo lo mostra", () => {
    assert.equal(serveUtenteInModifica(voce({ credential_type: "ssh" })), true);
    assert.equal(serveUtenteInModifica(voce({ credential_type: "linux" })), true);
    assert.equal(serveUtenteInModifica(voce({ credential_type: "windows" })), true);
    assert.equal(serveUtenteInModifica(voce({ credential_type: "api" })), true);
    assert.equal(serveUtenteInModifica(voce({ credential_type: "snmp", security_level: null })), false);
    assert.equal(serveUtenteInModifica(voce({ credential_type: "snmp", security_level: "authNoPriv" })), true);
  });
});

describe("controlli prima del salvataggio (gli stessi messaggi della pagina)", () => {
  it("nome vuoto", () => {
    assert.equal(erroreModulo(nuovo({ name: "  " })), "Nome richiesto");
  });

  it("SSH nuova senza password", () => {
    assert.equal(erroreModulo(nuovo({ name: "x", username: "admin" })), "Username e password richiesti");
  });

  it("SSH in modifica: password vuota = non modificare, lo username resta obbligatorio", () => {
    const base = statoModifica(voce({}), "admin");
    assert.equal(erroreModulo(base), null);
    assert.equal(erroreModulo({ ...base, form: { ...base.form, username: "" } }), "Username richiesto");
  });

  it("Windows, API e Linux come SSH", () => {
    for (const t of ["windows", "api", "linux"]) {
      assert.equal(erroreModulo(nuovo({ name: "x", credential_type: t, username: "u" })), "Username e password richiesti", t);
      assert.equal(erroreModulo(nuovo({ name: "x", credential_type: t, username: "u", password: "p" })), null, t);
    }
  });

  it("SNMP v2c nuova senza community", () => {
    assert.equal(
      erroreModulo(nuovo({ name: "x", credential_type: "snmp" })),
      "Community string richiesta per credenziali SNMP v2c (oppure imposta la sicurezza SNMPv3)",
    );
    assert.equal(erroreModulo(nuovo({ name: "x", credential_type: "snmp", password: "public" })), null);
  });

  it("porta fuori intervallo", () => {
    assert.equal(
      erroreModulo(nuovo({ name: "x", username: "u", password: "p", port: "70000" })),
      "Porta fra 1 e 65535, oppure vuota per la porta standard",
    );
    assert.equal(
      erroreModulo(nuovo({ name: "x", username: "u", password: "p", port: "0" })),
      "Porta fra 1 e 65535, oppure vuota per la porta standard",
    );
  });

  it("SNMPv3: protocolli e chiavi secondo il livello", () => {
    const v3 = (f: Partial<StatoModulo["form"]>) => nuovo({ name: "x", credential_type: "snmp", username: "m", ...f });
    assert.equal(erroreModulo(v3({ security_level: "noAuthNoPriv" })), null);
    assert.equal(erroreModulo(v3({ security_level: "authNoPriv" })), "Protocollo di autenticazione SNMPv3 richiesto");
    assert.equal(erroreModulo(v3({ security_level: "authNoPriv", auth_protocol: "SHA" })), "Chiave di autenticazione SNMPv3 richiesta");
    assert.equal(erroreModulo(v3({ security_level: "authNoPriv", auth_protocol: "SHA", auth_key: "k" })), null);
    assert.equal(
      erroreModulo(v3({ security_level: "authPriv", auth_protocol: "SHA", auth_key: "k" })),
      "Protocollo di privacy SNMPv3 richiesto",
    );
    assert.equal(
      erroreModulo(v3({ security_level: "authPriv", auth_protocol: "SHA", auth_key: "k", priv_protocol: "AES" })),
      "Chiave di privacy SNMPv3 richiesta",
    );
  });

  it("SNMPv3 in modifica: le chiavi già impostate non si richiedono", () => {
    const s = statoModifica(
      voce({ credential_type: "snmp", security_level: "authPriv", auth_protocol: "SHA", priv_protocol: "AES", encrypted_auth_key: "●", encrypted_priv_key: "●" }),
      "m",
    );
    assert.equal(erroreModulo(s), null);
  });

  it("un tipo che il modulo non conosce ancora: nessun controllo sui campi, decide il server", () => {
    assert.equal(erroreModulo(nuovo({ name: "x", credential_type: "unifi" })), null);
  });
});

describe("richiesta di salvataggio", () => {
  it("nuova SSH: POST con utente, password e porta assente se vuota", () => {
    const r = richiestaSalvataggio(nuovo({ name: "Router", username: "admin", password: "segreta" }));
    assert.equal(r.url, "/api/credentials");
    assert.equal(r.method, "POST");
    assert.deepEqual(JSON.parse(JSON.stringify(r.body)), {
      name: "Router",
      credential_type: "ssh",
      username: "admin",
      password: "segreta",
    });
  });

  it("nuova con porta propria", () => {
    const r = richiestaSalvataggio(nuovo({ name: "R", username: "a", password: "p", port: "2222" }));
    assert.equal((r.body as { port?: number }).port, 2222);
  });

  it("modifica: PUT sulla voce; password vuota non si manda; porta vuota = null (torna allo standard)", () => {
    const r = richiestaSalvataggio(statoModifica(voce({ port: 2222 }), "admin"));
    const s = { ...statoModifica(voce({ port: 2222 }), "admin") };
    s.form = { ...s.form, port: "" };
    const r2 = richiestaSalvataggio(s);
    assert.equal(r.url, "/api/credentials/5");
    assert.equal(r.method, "PUT");
    assert.deepEqual(JSON.parse(JSON.stringify(r.body)), {
      name: "Admin MikroTik",
      credential_type: "ssh",
      username: "admin",
      port: 2222,
    });
    assert.equal((r2.body as { port: number | null }).port, null);
  });

  it("SNMP: i campi v3 solo per il tipo snmp, le chiavi vuote non si mandano", () => {
    const r = richiestaSalvataggio(
      nuovo({ name: "v3", credential_type: "snmp", username: "m", security_level: "authNoPriv", auth_protocol: "SHA", auth_key: "k" }),
    );
    assert.deepEqual(JSON.parse(JSON.stringify(r.body)), {
      name: "v3",
      credential_type: "snmp",
      username: "m",
      password: "",
      security_level: "authNoPriv",
      auth_protocol: "SHA",
      auth_key: "k",
      priv_protocol: null,
    });
    const ssh = richiestaSalvataggio(nuovo({ name: "s", username: "a", password: "p", security_level: "authPriv" }));
    assert.equal("security_level" in (ssh.body as object), false);
  });
});

describe("tendina del tipo", () => {
  it("segnaposto della porta: lo standard del tipo, o solo «standard» se non lo si conosce", () => {
    assert.equal(segnapostoPorta("ssh"), "standard (22)");
    assert.equal(segnapostoPorta("linux"), "standard (22)");
    assert.equal(segnapostoPorta("snmp"), "standard (161)");
    assert.equal(segnapostoPorta("windows"), "standard (5985)");
    assert.equal(segnapostoPorta("api"), "standard (443)");
    assert.equal(segnapostoPorta("unifi"), "standard");
  });

  it("una voce di un tipo fuori dalle opzioni (una «linux» vecchia) resta visibile in modifica", () => {
    const opzioni = [{ value: "ssh", label: "SSH (password o chiave)" }];
    assert.deepEqual(opzioniConTipoAttuale(opzioni, "ssh"), opzioni);
    assert.deepEqual(opzioniConTipoAttuale(opzioni, "linux"), [...opzioni, { value: "linux", label: "Linux (come SSH)" }]);
  });
});
