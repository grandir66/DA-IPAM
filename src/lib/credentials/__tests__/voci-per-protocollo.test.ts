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
 * Le rotte non si chiamano in una prova (sessione di NextAuth): il controllo e
 * la scrittura stanno in funzioni (lega-voce.ts, salva-rete.ts) che si
 * eseguono qui sul DB vero; alle rotte resta la traduzione del rifiuto in 400.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/credentials/__tests__/voci-per-protocollo.test.ts
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import {
  VoceNonValePerProtocollo,
  aggiungiBindingApparato,
  aggiornaBindingApparato,
  aggiungiRigaHost,
  assegnaCredenzialeAgliHost,
  creaIntegrazioneAd,
  aggiornaIntegrazioneAd,
} from "../lega-voce";

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

// ── chi lega una voce a un protocollo: eseguito sul DB vero ──
// Revisione della 2c (16/10): prima queste prove leggevano il sorgente delle
// rotte e guardavano solo che il testo del controllo venisse prima della
// scrittura. Un protocollo fisso al posto di `protocol_type`, o il 400 in un
// altro ramo, passavano lo stesso. Il controllo e la scrittura stanno ora in
// lega-voce.ts e si eseguono; alla rotta resta la traduzione in 400.

const MSG_AD_WINRM = "La credenziale «Account dominio» è di tipo Active Directory, non vale per WinRM";
const rifiuto = (atteso: string) => (e: unknown) => e instanceof VoceNonValePerProtocollo && e.message === atteso;
const conta = (sql: string, ...p: unknown[]) => (dbt().prepare(sql).get(...p) as { n: number }).n;

let host1 = 0;
let host2 = 0;
let apparato = 0;

before(() => {
  withTenant(T, () => {
    host1 = Number(dbt().prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.73.0.11')").run(rete).lastInsertRowid);
    host2 = Number(dbt().prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.73.0.12')").run(rete).lastInsertRowid);
    apparato = Number(
      dbt()
        .prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('srv', '10.73.0.11', 'server', 'windows', 'winrm')")
        .run().lastInsertRowid,
    );
  });
});

describe("una voce AD come binding WinRM → rifiuto (400), niente scritto", () => {
  it("aggiunta: AD rifiutata col messaggio, Windows scritta", () => {
    withTenant(T, () => {
      const prima = conta("SELECT COUNT(*) AS n FROM device_credential_bindings WHERE device_id = ?", apparato);
      assert.throws(() => aggiungiBindingApparato({ device_id: apparato, credential_id: AD, protocol_type: "winrm", port: 5985 }), rifiuto(MSG_AD_WINRM));
      assert.equal(conta("SELECT COUNT(*) AS n FROM device_credential_bindings WHERE device_id = ?", apparato), prima);
      const b = aggiungiBindingApparato({ device_id: apparato, credential_id: WIN, protocol_type: "winrm", port: 5985 });
      assert.equal(b.credential_id, WIN);
      assert.equal(conta("SELECT COUNT(*) AS n FROM device_credential_bindings WHERE device_id = ?", apparato), prima + 1);
    });
  });

  it("modifica: voce AD al posto della Windows, o protocollo cambiato con una voce che non vale → rifiuto, binding com'era", () => {
    withTenant(T, () => {
      const b = aggiungiBindingApparato({ device_id: apparato, credential_id: WIN, protocol_type: "winrm", port: 5986 });
      const riga = () => dbt().prepare("SELECT credential_id, protocol_type, port FROM device_credential_bindings WHERE id = ?").get(b.id);
      const com = riga();
      assert.throws(() => aggiornaBindingApparato(apparato, b.id, { credential_id: AD }), rifiuto(MSG_AD_WINRM));
      assert.deepEqual(riga(), com);
      // Il protocollo nuovo, non quello del binding: una Windows non vale per SSH.
      assert.throws(
        () => aggiornaBindingApparato(apparato, b.id, { protocol_type: "ssh", port: 22 }),
        rifiuto("La credenziale «Admin Windows» è di tipo Windows (WinRM e WMI), non vale per SSH"),
      );
      assert.deepEqual(riga(), com);
      // Voce e protocollo che valgono: scritto.
      assert.equal(aggiornaBindingApparato(apparato, b.id, { credential_id: SSH, protocol_type: "ssh", port: 22 }), true);
      assert.deepEqual(riga(), { credential_id: SSH, protocol_type: "ssh", port: 22 });
      // Dalla 2e (T20) un binding non passa più a inline e non perde la voce:
      // il protocollo nuovo si controlla con la voce che ha.
      assert.throws(() => aggiornaBindingApparato(apparato, b.id, { protocol_type: "winrm", port: 5985 }), /non vale per WinRM/);
      assert.deepEqual(riga(), { credential_id: SSH, protocol_type: "ssh", port: 22 });
      // Un binding di un altro apparato, o che non c'è: false, la rotta risponde 404.
      assert.equal(aggiornaBindingApparato(apparato + 1000, b.id, { port: 1 }), false);
    });
  });
});

describe("una voce AD come riga host WinRM → rifiuto (400), niente scritto", () => {
  const righe = (hostId: number) => conta("SELECT COUNT(*) AS n FROM host_credentials WHERE host_id = ?", hostId);

  it("riga di un host: AD rifiutata col messaggio, Windows scritta", () => {
    withTenant(T, () => {
      assert.throws(() => aggiungiRigaHost(host2, AD, "winrm", 5985), rifiuto(MSG_AD_WINRM));
      assert.equal(righe(host2), 0);
      aggiungiRigaHost(host2, WIN, "winrm", 5985);
      assert.equal(righe(host2), 1);
      dbt().prepare("DELETE FROM host_credentials WHERE host_id = ?").run(host2);
    });
  });

  it("modifica in blocco: AD rifiutata prima di toccare qualunque host; Windows a tutti e al loro apparato", () => {
    withTenant(T, () => {
      const binding = () => conta("SELECT COUNT(*) AS n FROM device_credential_bindings WHERE device_id = ? AND credential_id = ? AND port = 5985", apparato, WIN);
      dbt().prepare("DELETE FROM device_credential_bindings WHERE device_id = ?").run(apparato);
      assert.throws(() => assegnaCredenzialeAgliHost([host1, host2], AD, "winrm", 5985), rifiuto(MSG_AD_WINRM));
      assert.equal(righe(host1) + righe(host2), 0);
      assert.equal(conta("SELECT COUNT(*) AS n FROM device_credential_bindings WHERE device_id = ?", apparato), 0);

      const esito = assegnaCredenzialeAgliHost([host1, host2], WIN, "winrm", 5985);
      assert.deepEqual(esito, { aggiunte: 2, falliti: [] });
      assert.equal(righe(host1), 1);
      assert.equal(righe(host2), 1);
      assert.equal(binding(), 1, "l'apparato di host1 riceve il binding");
      // Una seconda volta non raddoppia niente.
      assert.deepEqual(assegnaCredenzialeAgliHost([host1, host2], WIN, "winrm", 5985), { aggiunte: 0, falliti: [] });
      assert.equal(binding(), 1);
    });
  });

  it("modifica in blocco: un host che non c'è si dice, gli altri si scrivono", () => {
    withTenant(T, () => {
      dbt().prepare("DELETE FROM host_credentials WHERE host_id IN (?, ?)").run(host1, host2);
      const esito = assegnaCredenzialeAgliHost([host2, 987654], SSH, "ssh", 22);
      assert.deepEqual(esito, { aggiunte: 1, falliti: [987654] });
      assert.equal(righe(host2), 1);
    });
  });
});

describe("una voce AD come winrm_credential_id dell'AD → rifiuto (400), niente scritto", () => {
  const datiAd = { name: "dominio", dc_host: "dc.esempio.local", domain: "esempio.local", base_dn: "DC=esempio,DC=local", encrypted_username: encrypt("u"), encrypted_password: encrypt("p") };

  it("creazione: AD rifiutata col messaggio, Windows scritta; modifica: AD rifiutata, valore com'era", () => {
    withTenant(T, () => {
      const prima = conta("SELECT COUNT(*) AS n FROM ad_integrations");
      assert.throws(() => creaIntegrazioneAd({ ...datiAd, winrm_credential_id: AD }), rifiuto(MSG_AD_WINRM));
      assert.equal(conta("SELECT COUNT(*) AS n FROM ad_integrations"), prima);

      const ad = creaIntegrazioneAd({ ...datiAd, winrm_credential_id: WIN });
      assert.equal(ad.winrm_credential_id, WIN);
      const winrm = () => (dbt().prepare("SELECT winrm_credential_id AS w, name FROM ad_integrations WHERE id = ?").get(ad.id) as { w: number | null; name: string });

      assert.throws(() => aggiornaIntegrazioneAd(ad.id, { name: "cambiato", winrm_credential_id: AD }), rifiuto(MSG_AD_WINRM));
      assert.deepEqual(winrm(), { w: WIN, name: "dominio" });
      assert.throws(() => aggiornaIntegrazioneAd(ad.id, { winrm_credential_id: SSH }), (e: unknown) => e instanceof VoceNonValePerProtocollo);
      // Togliere la voce WinRM resta possibile.
      aggiornaIntegrazioneAd(ad.id, { winrm_credential_id: null });
      assert.deepEqual(winrm(), { w: null, name: "dominio" });
    });
  });
});

// ── invariante: le rotte scrivono solo passando dal controllo ──

const RADICE = process.cwd();
const ROTTE = [
  "src/app/api/devices/[id]/credentials/route.ts",
  "src/app/api/hosts/[id]/credentials/route.ts",
  "src/app/api/hosts/bulk-update/route.ts",
  "src/app/api/ad/route.ts",
  "src/app/api/ad/[id]/route.ts",
];
const SCRITTORI_NUDI = /\b(addDeviceCredentialBinding|updateDeviceCredentialBinding|addHostCredential|createAdIntegration|updateAdIntegration)\b/;

describe("invariante: le rotte non chiamano gli scrittori senza controllo", () => {
  for (const r of ROTTE) {
    it(r, () => {
      assert.doesNotMatch(readFileSync(join(RADICE, r), "utf8"), SCRITTORI_NUDI, "la rotta deve passare da lega-voce.ts");
    });
  }
});
