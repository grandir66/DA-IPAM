/**
 * Pagina Credenziali e API sui tipi per esteso; voci in uso (tappa 2
 * credenziali, T13, 16/10).
 *
 * Perché:
 * - il validatore accettava cinque codici grezzi e i campi richiesti erano
 *   regole scritte a mano nella rotta: una voce UniFi, Omada o AD, o una SSH a
 *   chiave, non si poteva creare, e una «linux» nasceva ancora «linux»;
 * - l'eliminazione di una voce in uso toglieva in silenzio binding, catene e
 *   righe host (CASCADE) e spegneva il WinRM dell'AD (SET NULL): D8 = (a),
 *   rifiutata con l'elenco degli usi, e così il cambio di tipo;
 * - le risposte erano la riga del DB con le colonne cifrate sovrascritte a
 *   mano: una colonna cifrata nuova non mascherata passava dallo spread.
 *
 * Le rotte passano dalla sessione di NextAuth e non si chiamano in una prova:
 * qui si chiamano le funzioni che le rotte usano, sul DB di un tenant con lo
 * schema vero (getTenantDb).
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/credentials/__tests__/archivio-voci.test.ts
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt, safeDecrypt } from "@/lib/crypto";
import { withTenant, getTenantDb, deleteTenantDatabase, createCredential as creaTenant } from "@/lib/db-tenant";
import { createCredential as creaFacciata } from "@/lib/db";
import { CredentialSchema } from "@/lib/validators";
import { creaVoceDb, modificaVoceDb, eliminaVoceDb } from "../archivio";
import { mascheraCredenziale } from "../maschera";
import { usiCredenzialeDb, usiTotaliDb, totaleUsi } from "../usi";
import type { Credential } from "@/types";
import { creaCateneVecchie } from "@/lib/__tests__/support/catene-vecchie";

const T = "TESTARCHIVIOVOCI";
const dbt = () => getTenantDb(T);

/** Il corpo come lo vede la rotta: dopo CredentialSchema. */
function corpo(b: Record<string, unknown>) {
  const p = CredentialSchema.safeParse(b);
  assert.ok(p.success, p.success ? "" : p.error.issues.map((i) => i.message).join(", "));
  return p.data;
}

function corpoParziale(b: Record<string, unknown>) {
  const p = CredentialSchema.partial().safeParse(b);
  assert.ok(p.success, p.success ? "" : p.error.issues.map((i) => i.message).join(", "));
  return p.data;
}

const riga = (id: number) => dbt().prepare("SELECT * FROM credentials WHERE id = ?").get(id) as Credential | undefined;

function voce(nome: string, tipo: string): number {
  return Number(
    dbt()
      .prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)")
      .run(nome, tipo, encrypt("utente"), encrypt("segreto")).lastInsertRowid,
  );
}

let reteId = 0;
let hostId = 0;
let apparatoId = 0;

before(() => {
  withTenant(T, () => {
    reteId = Number(dbt().prepare("INSERT INTO networks (cidr, name) VALUES ('10.72.0.0/24', 'LAN prova')").run().lastInsertRowid);
    hostId = Number(dbt().prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.72.0.5')").run(reteId).lastInsertRowid);
    apparatoId = Number(
      dbt()
        .prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('SW-prova', '10.72.0.2', 'switch', 'hp', 'ssh')")
        .run().lastInsertRowid,
    );
  });
});

after(() => deleteTenantDatabase(T));

describe("POST: tipi per esteso e campi richiesti da tipi.ts", () => {
  it("il tipo «linux» si crea come «ssh»", () => {
    withTenant(T, () => {
      const esito = creaVoceDb(dbt(), corpo({ name: "vecchia linux", credential_type: "linux", username: "root", password: "pw" }));
      assert.ok(esito.ok, esito.ok ? "" : esito.errore);
      assert.equal(esito.stato, 201);
      assert.equal(riga(esito.vista.id)?.credential_type, "ssh");
      assert.equal(esito.vista.credential_type, "ssh");
    });
  });

  it("createCredential (le due gemelle) scrive «linux» come «ssh» e rifiuta un tipo sconosciuto", () => {
    withTenant(T, () => {
      assert.equal(creaTenant({ name: "gemella tenant", credential_type: "linux" }).credential_type, "ssh");
      assert.equal(creaFacciata({ name: "gemella facciata", credential_type: "linux" }).credential_type, "ssh");
      assert.throws(() => creaTenant({ name: "boh", credential_type: "telnet" }), /sconosciuto/);
      assert.throws(() => creaFacciata({ name: "boh", credential_type: "telnet" }), /sconosciuto/);
    });
  });

  it("UniFi col metodo «chiave» senza chiave → 400 col messaggio, niente scritto", () => {
    withTenant(T, () => {
      const prima = (dbt().prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n;
      const esito = creaVoceDb(dbt(), corpo({ name: "controller", credential_type: "unifi", auth_method: "chiave" }));
      assert.equal(esito.ok, false);
      assert.ok(!esito.ok);
      assert.equal(esito.stato, 400);
      assert.match(esito.errore, /chiave API/);
      const dopo = (dbt().prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n;
      assert.equal(dopo, prima);
    });
  });

  it("UniFi con la chiave → 201, la chiave in encrypted_password", () => {
    withTenant(T, () => {
      const esito = creaVoceDb(dbt(), corpo({ name: "console", credential_type: "unifi", auth_method: "chiave", password: "chiave-api-1" }));
      assert.ok(esito.ok, esito.ok ? "" : esito.errore);
      const r = riga(esito.vista.id)!;
      assert.equal(r.credential_type, "unifi");
      assert.equal(r.auth_method, "chiave");
      assert.equal(safeDecrypt(r.encrypted_password!), "chiave-api-1");
    });
  });

  it("SSH a chiave: utente e chiave privata obbligatori, passphrase facoltativa", () => {
    withTenant(T, () => {
      const senza = creaVoceDb(dbt(), corpo({ name: "ssh chiave", credential_type: "ssh", auth_method: "chiave", username: "root" }));
      assert.ok(!senza.ok);
      assert.equal(senza.stato, 400);
      assert.match(senza.errore, /chiave privata/);
      const con = creaVoceDb(dbt(), corpo({ name: "ssh chiave", credential_type: "ssh", auth_method: "chiave", username: "root", private_key: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n" }));
      assert.ok(con.ok, con.ok ? "" : con.errore);
      const r = riga(con.vista.id)!;
      assert.equal(safeDecrypt(r.encrypted_private_key!), "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n");
      assert.equal(r.encrypted_key_passphrase, null);
      assert.equal(r.encrypted_password, null);
      assert.equal(con.vista.ha_chiave_privata, true);
    });
  });

  it("un metodo che il tipo non ha → 400", () => {
    withTenant(T, () => {
      const esito = creaVoceDb(dbt(), corpo({ name: "win", credential_type: "windows", auth_method: "token", username: "a", password: "b" }));
      assert.ok(!esito.ok);
      assert.equal(esito.stato, 400);
      assert.match(esito.errore, /metodo/);
    });
  });

  it("SNMP v1/v2c coi campi v3 → 400: la v3 è un tipo a sé", () => {
    withTenant(T, () => {
      const esito = creaVoceDb(dbt(), corpo({ name: "ibrida", credential_type: "snmp", password: "public", security_level: "authNoPriv", auth_protocol: "SHA", auth_key: "k" }));
      assert.ok(!esito.ok);
      assert.equal(esito.stato, 400);
      assert.match(esito.errore, /SNMP v3/);
    });
  });

  it("SNMP v3 authPriv: senza la chiave di privacy → 400; completa → 201 senza community", () => {
    withTenant(T, () => {
      const base = { name: "v3", credential_type: "snmp_v3", username: "monitor", security_level: "authPriv", auth_protocol: "SHA", auth_key: "chiave-auth", priv_protocol: "AES" };
      const senza = creaVoceDb(dbt(), corpo(base));
      assert.ok(!senza.ok);
      assert.equal(senza.stato, 400);
      assert.match(senza.errore, /privacy/);
      const con = creaVoceDb(dbt(), corpo({ ...base, priv_key: "chiave-priv" }));
      assert.ok(con.ok, con.ok ? "" : con.errore);
      const r = riga(con.vista.id)!;
      assert.equal(r.credential_type, "snmp_v3");
      assert.equal(r.encrypted_password, null);
      assert.equal(safeDecrypt(r.encrypted_auth_key!), "chiave-auth");
    });
  });

  it("limiti del validatore: chiave privata fino a 16384 caratteri, utente fino a 256", () => {
    assert.equal(CredentialSchema.safeParse({ name: "k", credential_type: "ssh", private_key: "x".repeat(16384) }).success, true);
    assert.equal(CredentialSchema.safeParse({ name: "k", credential_type: "ssh", private_key: "x".repeat(16385) }).success, false);
    assert.equal(CredentialSchema.safeParse({ name: "k", credential_type: "ssh", username: "u".repeat(256) }).success, true);
    assert.equal(CredentialSchema.safeParse({ name: "k", credential_type: "ssh", username: "u".repeat(257) }).success, false);
    assert.equal(CredentialSchema.safeParse({ name: "k", credential_type: "ssh", passphrase: "p".repeat(1025) }).success, false);
    assert.equal(CredentialSchema.safeParse({ name: "k", credential_type: "ssh", password: "p".repeat(4097) }).success, false);
    assert.equal(CredentialSchema.safeParse({ name: "k", credential_type: "telnet" }).success, false);
  });
});

describe("PUT: tipo di una voce in uso, campi richiesti sulla voce risultante", () => {
  it("cambiare tipo a una voce in uso → 409 con gli usi, niente scritto", () => {
    withTenant(T, () => {
      const id = voce("in uso per tipo", "ssh");
      dbt().prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port) VALUES (?, ?, 'ssh', 22)").run(apparatoId, id);
      const esito = modificaVoceDb(dbt(), id, corpoParziale({ credential_type: "windows" }), { credential_type: "windows" });
      assert.ok(!esito.ok);
      assert.equal(esito.stato, 409);
      assert.ok(esito.usi, "la risposta non porta gli usi");
      assert.deepEqual(esito.usi.apparati, [{ id: apparatoId, nome: "SW-prova", come: "binding" }]);
      assert.equal(riga(id)?.credential_type, "ssh");
    });
  });

  it("cambiare tipo a una voce non in uso → 200", () => {
    withTenant(T, () => {
      const id = voce("libera", "ssh");
      const esito = modificaVoceDb(dbt(), id, corpoParziale({ credential_type: "windows" }), { credential_type: "windows" });
      assert.ok(esito.ok, esito.ok ? "" : esito.errore);
      assert.equal(riga(id)?.credential_type, "windows");
    });
  });

  it("«linux» → «ssh» non è un cambio di tipo, anche in uso", () => {
    withTenant(T, () => {
      const id = voce("linux in uso", "linux");
      dbt().prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, 99)").run(reteId, id);
      const esito = modificaVoceDb(dbt(), id, corpoParziale({ credential_type: "linux", name: "rinominata" }), { credential_type: "linux", name: "rinominata" });
      assert.ok(esito.ok, esito.ok ? "" : esito.errore);
      assert.equal(riga(id)?.credential_type, "ssh");
      assert.equal(riga(id)?.name, "rinominata");
    });
  });

  it("segreto vuoto = non modificare; i campi richiesti si guardano sulla voce salvata più le modifiche", () => {
    withTenant(T, () => {
      const id = voce("ssh password", "ssh");
      const soloNome = modificaVoceDb(dbt(), id, corpoParziale({ name: "ssh password 2", password: "" }), { name: "ssh password 2", password: "" });
      assert.ok(soloNome.ok, soloNome.ok ? "" : soloNome.errore);
      assert.equal(safeDecrypt(riga(id)!.encrypted_password!), "segreto");
      // Passare a chiave senza mandarla: la voce risultante non ha la chiave.
      const aChiave = modificaVoceDb(dbt(), id, corpoParziale({ auth_method: "chiave" }), { auth_method: "chiave" });
      assert.ok(!aChiave.ok);
      assert.equal(aChiave.stato, 400);
      assert.match(aChiave.errore, /chiave privata/);
      assert.equal(riga(id)?.auth_method, null);
    });
  });

  it("passando a chiave la password vecchia si toglie (il trasporto proverebbe ancora quella)", () => {
    withTenant(T, () => {
      const id = voce("ssh verso chiave", "ssh");
      const esito = modificaVoceDb(dbt(), id, corpoParziale({ auth_method: "chiave", private_key: "CHIAVE" }), { auth_method: "chiave", private_key: "CHIAVE" });
      assert.ok(esito.ok, esito.ok ? "" : esito.errore);
      const r = riga(id)!;
      assert.equal(r.auth_method, "chiave");
      assert.equal(r.encrypted_password, null);
      assert.equal(safeDecrypt(r.encrypted_username!), "utente");
      assert.equal(safeDecrypt(r.encrypted_private_key!), "CHIAVE");
    });
  });

  it("voce che non c'è → 404", () => {
    withTenant(T, () => {
      const esito = modificaVoceDb(dbt(), 987654, corpoParziale({ name: "x" }), { name: "x" });
      assert.ok(!esito.ok);
      assert.equal(esito.stato, 404);
    });
  });
});

describe("DELETE: una voce in uso non si elimina (D8 = (a))", () => {
  it("voce in uso → 409 con gli usi; voce, binding e catene restano", () => {
    withTenant(T, () => {
      const id = voce("da non eliminare", "windows");
      dbt().prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port) VALUES (?, ?, 'winrm', 5985)").run(apparatoId, id);
      dbt().prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, 50)").run(reteId, id);
      const esito = eliminaVoceDb(dbt(), id);
      assert.ok(!esito.ok);
      assert.equal(esito.stato, 409);
      assert.match(esito.errore, /in uso/);
      assert.deepEqual(esito.usi?.reti, [{ id: reteId, nome: "LAN prova" }]);
      assert.ok(riga(id), "la voce è stata eliminata");
      const binding = dbt().prepare("SELECT COUNT(*) AS n FROM device_credential_bindings WHERE credential_id = ?").get(id) as { n: number };
      assert.equal(binding.n, 1);
    });
  });

  it("voce non in uso → eliminata", () => {
    withTenant(T, () => {
      const id = voce("da eliminare", "api");
      const esito = eliminaVoceDb(dbt(), id);
      assert.ok(esito.ok, esito.ok ? "" : esito.errore);
      assert.equal(riga(id), undefined);
    });
  });

  it("voce che non c'è → 404", () => {
    withTenant(T, () => {
      const esito = eliminaVoceDb(dbt(), 987655);
      assert.ok(!esito.ok);
      assert.equal(esito.stato, 404);
    });
  });
});

describe("risposte: nessuna colonna cifrata e nessun segreto", () => {
  it("mascheraCredenziale non restituisce colonne encrypted_* (lette dallo schema) né segreti, in chiaro o cifrati", () => {
    withTenant(T, () => {
      const cifrate = (dbt().prepare("PRAGMA table_info(credentials)").all() as Array<{ name: string }>)
        .map((c) => c.name)
        .filter((n) => /encrypt/i.test(n));
      assert.ok(cifrate.length >= 6, `colonne cifrate lette dallo schema: ${cifrate.join(", ")}`);
      const chiari = new Map(cifrate.map((c) => [c, `segreto-${c}`]));
      const cifrati = new Map(cifrate.map((c) => [c, encrypt(chiari.get(c)!)]));
      const id = voce("tutte le colonne", "ssh");
      for (const c of cifrate) dbt().prepare(`UPDATE credentials SET ${c} = ? WHERE id = ?`).run(cifrati.get(c), id);
      const vista = mascheraCredenziale(riga(id)!, 3);
      const testo = JSON.stringify(vista);
      for (const chiave of Object.keys(vista)) assert.doesNotMatch(chiave, /encrypt/i, `colonna restituita: ${chiave}`);
      for (const c of cifrate) {
        assert.equal(testo.includes(chiari.get(c)!), false, `segreto in chiaro di ${c}`);
        assert.equal(testo.includes(cifrati.get(c)!), false, `testo cifrato di ${c}`);
      }
      assert.equal(vista.usi_totale, 3);
      assert.equal(vista.ha_password, true);
      assert.equal(vista.ha_chiave_privata, true);
      assert.equal(vista.etichetta, "SSH (password o chiave)");
    });
  });

  it("gli esiti di POST e PUT sono già la vista mascherata", () => {
    withTenant(T, () => {
      const nuova = creaVoceDb(dbt(), corpo({ name: "vista", credential_type: "api", username: "u", password: "segreto-vista" }));
      assert.ok(nuova.ok, nuova.ok ? "" : nuova.errore);
      const mod = modificaVoceDb(dbt(), nuova.vista.id, corpoParziale({ password: "segreto-nuovo" }), { password: "segreto-nuovo" });
      assert.ok(mod.ok, mod.ok ? "" : mod.errore);
      for (const v of [nuova.vista, mod.vista]) {
        const testo = JSON.stringify(v);
        assert.doesNotMatch(testo, /encrypt|segreto-vista|segreto-nuovo/);
      }
    });
  });
});

describe("usi di una voce", () => {
  it("usiCredenzialeDb elenca ogni uso, usiTotaliDb dà gli stessi totali per tutte le voci", () => {
    withTenant(T, () => {
      const id = voce("molto usata", "windows");
      const d = dbt();
      // Un DB di prima della pulizia della 2g (T27): le tabelle vecchie ci sono ancora.
      creaCateneVecchie(d);
      d.prepare("UPDATE network_devices SET credential_id = ? WHERE id = ?").run(id, apparatoId);
      d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port) VALUES (?, ?, 'winrm', 5986)").run(apparatoId, id);
      d.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, 70)").run(reteId, id);
      d.prepare("INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?, ?, 'windows', 0)").run(reteId, id);
      d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (?, ?, 'winrm', 5985)").run(hostId, id);
      d.prepare("INSERT INTO host_detect_credential (host_id, role, credential_id) VALUES (?, 'windows', ?)").run(hostId, id);
      const adId = Number(
        d.prepare("INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, winrm_credential_id) VALUES ('dominio', 'dc1', 'ad.local', 'DC=ad', 'x', 'y', ?)").run(id).lastInsertRowid,
      );
      d.prepare("INSERT INTO proxmox_hosts (name, host, credential_id) VALUES ('pve', '10.72.0.9', ?)").run(id);
      d.prepare("INSERT INTO software_scans (host_id, started_at, status, os_family, probe, credential_id) VALUES (?, datetime('now'), 'ok', 'windows', 'winrm', ?)").run(hostId, id);

      const usi = usiCredenzialeDb(d, id);
      // Dalla 2g (T26) la colonna dell'apparato e le catene vecchie non sono usi: il motore non le legge più.
      assert.deepEqual(usi.apparati, [{ id: apparatoId, nome: "SW-prova", come: "binding" }]);
      assert.deepEqual(usi.reti, [{ id: reteId, nome: "LAN prova" }]);
      assert.equal(usi.host, 1);
      assert.deepEqual(usi.controller, []);
      assert.deepEqual(usi.ad, [{ id: adId, nome: "dominio", come: "winrm" }]);
      assert.equal(usi.proxmox, 1);
      assert.equal(usi.scansioniSoftware, 1);
      // Le scansioni software sono storia: non tengono ferma una voce. (Erano 6 con la colonna dell'apparato, fino alla 2g.)
      assert.equal(totaleUsi(usi), 5);

      const totali = usiTotaliDb(d);
      const voci = d.prepare("SELECT id FROM credentials").all() as Array<{ id: number }>;
      for (const { id: v } of voci) {
        assert.equal(totali.get(v) ?? 0, totaleUsi(usiCredenzialeDb(d, v)), `voce #${v}`);
      }

      // Una voce usata solo dalla storia delle scansioni si elimina.
      d.prepare("UPDATE network_devices SET credential_id = NULL WHERE id = ?").run(apparatoId);
      for (const t of ["device_credential_bindings", "network_credentials", "network_host_credentials", "host_credentials", "host_detect_credential"]) {
        d.prepare(`DELETE FROM ${t} WHERE credential_id = ?`).run(id);
      }
      d.prepare("UPDATE ad_integrations SET winrm_credential_id = NULL WHERE id = ?").run(adId);
      d.prepare("UPDATE proxmox_hosts SET credential_id = NULL WHERE credential_id = ?").run(id);
      assert.equal(totaleUsi(usiCredenzialeDb(d, id)), 0);
      assert.ok(eliminaVoceDb(d, id).ok);
    });
  });
});
