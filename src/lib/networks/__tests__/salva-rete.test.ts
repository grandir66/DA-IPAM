/**
 * Salvataggio della rete con le credenziali (tappa 2 credenziali, T12, 16/10).
 *
 * Perché:
 * - il PUT di /api/networks/[id] ignorava `credential_ids`. La pagina della
 *   rete salvava la lista con una seconda richiesta in parallelo, che
 *   ingoiava gli errori, e rimandava le quattro catene vecchie nascoste;
 * - dalla 2c le voci `linux` diventano `ssh`: il ruolo `linux` delle catene
 *   rifiutava una voce `ssh`, e la rotta rispondeva 400 dopo aver già creato
 *   o modificato la rete.
 *
 * Le rotte passano dalla sessione di NextAuth e non si chiamano in una
 * prova: qui si chiama la funzione che le rotte usano, con il facade del DB
 * dentro `withTenant`, come in una richiesta.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/networks/__tests__/salva-rete.test.ts
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import {
  withTenant,
  getTenantDb,
  deleteTenantDatabase,
  replaceNetworkHostCredentials as catenaTenant,
  setHostDetectCredential as pinTenant,
} from "@/lib/db-tenant";
import { replaceNetworkHostCredentials as catenaFacciata, setHostDetectCredential as pinFacciata } from "@/lib/db";
import { NetworkUpdateSchema } from "@/lib/validators";
import { aggiornaRete, creaRete, CredenzialiReteNonValide } from "../salva-rete";

const T = "TESTSALVARETE";
const SSH = 501;
const WIN = 502;
const SNMP = 503;
const SNMP_V3 = 504;

const dbt = () => getTenantDb(T);

function voce(id: number, tipo: string): void {
  dbt()
    .prepare(`INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?, ?)`)
    .run(id, `voce ${id}`, tipo, encrypt("utente"), encrypt("segreto"));
}

const lista = (networkId: number) =>
  (dbt().prepare(`SELECT credential_id FROM network_credentials WHERE network_id = ? ORDER BY sort_order`).all(networkId) as Array<{ credential_id: number }>).map((r) => r.credential_id);

const catena = (networkId: number, ruolo: string) =>
  (dbt().prepare(`SELECT credential_id FROM network_host_credentials WHERE network_id = ? AND role = ? ORDER BY sort_order`).all(networkId, ruolo) as Array<{ credential_id: number }>).map((r) => r.credential_id);

const reteDaCidr = (cidr: string) => dbt().prepare(`SELECT id, name FROM networks WHERE cidr = ?`).get(cidr) as { id: number; name: string } | undefined;

before(() => {
  withTenant(T, () => {
    voce(SSH, "ssh");
    voce(WIN, "windows");
    voce(SNMP, "snmp");
    voce(SNMP_V3, "snmp_v3");
  });
});

after(() => deleteTenantDatabase(T));

describe("PUT della rete (aggiornaRete)", () => {
  it("applica credential_ids nell'ordine dato e lo restituisce", () => {
    withTenant(T, () => {
      const r = creaRete({ cidr: "10.71.1.0/24", name: "rete put", description: "", location: "" });
      const salvata = aggiornaRete(r.id, { name: "rete put 2", credential_ids: [SNMP, SSH, WIN] });
      assert.ok(salvata, "rete non trovata");
      assert.deepEqual(lista(r.id), [SNMP, SSH, WIN], "la lista della rete non è quella mandata");
      assert.deepEqual(salvata.credential_ids, [SNMP, SSH, WIN], "la risposta non restituisce la lista");
      assert.equal(salvata.name, "rete put 2");
    });
  });

  it("il corpo della pagina della rete (gateway vuoto → null) passa lo schema e salva la lista", () => {
    // La pagina manda `gateway: null` quando il campo è vuoto, e lo schema
    // non accettava null: «Invalid input». Prima la lista si salvava lo
    // stesso con la seconda richiesta; col PUT unico non si salverebbe più.
    withTenant(T, () => {
      const r = creaRete({ cidr: "10.71.5.0/24", name: "senza gateway", description: "", location: "" });
      const corpo = {
        cidr: "10.71.5.0/24", name: "senza gateway", description: "", gateway: null, vlan_id: null, location: "",
        snmp_community: null, dns_server: null, router_id: null, credential_ids: [SSH, SNMP_V3],
      };
      const parsed = NetworkUpdateSchema.safeParse(corpo);
      assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
      const salvata = aggiornaRete(r.id, parsed.data);
      assert.deepEqual(salvata?.credential_ids, [SSH, SNMP_V3]);
      assert.equal(salvata?.gateway ?? null, null);
    });
  });

  it("senza credential_ids la lista resta com'è", () => {
    withTenant(T, () => {
      const r = creaRete({ cidr: "10.71.2.0/24", name: "rete lista", description: "", location: "", credential_ids: [SSH] });
      aggiornaRete(r.id, { name: "rinominata" });
      assert.deepEqual(lista(r.id), [SSH]);
    });
  });

  it("una voce rifiutata non lascia scritta la modifica della rete (prima: 400 a rete già salvata)", () => {
    withTenant(T, () => {
      const r = creaRete({ cidr: "10.71.3.0/24", name: "prima", description: "", location: "" });
      assert.throws(
        () => aggiornaRete(r.id, { name: "dopo", windows_credential_ids: [SSH] }),
        (e: unknown) => e instanceof CredenzialiReteNonValide,
      );
      assert.equal(reteDaCidr("10.71.3.0/24")?.name, "prima", "la rete è stata modificata nonostante il rifiuto");
    });
  });

  it("una voce che non esiste più → rifiuto dichiarato, non un errore di vincolo", () => {
    withTenant(T, () => {
      const r = creaRete({ cidr: "10.71.4.0/24", name: "fantasma", description: "", location: "" });
      assert.throws(
        () => aggiornaRete(r.id, { credential_ids: [SSH, 999_999] }),
        (e: unknown) => e instanceof CredenzialiReteNonValide && /non esiste/.test(e.message),
      );
      assert.deepEqual(lista(r.id), []);
    });
  });
});

describe("POST della rete (creaRete)", () => {
  it("il ruolo linux accetta una voce ssh: la rete nasce e la catena è applicata", () => {
    withTenant(T, () => {
      const r = creaRete({ cidr: "10.72.1.0/24", name: "linux ssh", description: "", location: "", linux_credential_ids: [SSH] });
      assert.ok(r.id > 0);
      assert.deepEqual(catena(r.id, "linux"), [SSH]);
    });
  });

  it("una voce rifiutata non lascia una rete creata a metà", () => {
    withTenant(T, () => {
      assert.throws(
        () => creaRete({ cidr: "10.72.2.0/24", name: "a metà", description: "", location: "", windows_credential_ids: [SSH] }),
        (e: unknown) => e instanceof CredenzialiReteNonValide,
      );
      assert.equal(reteDaCidr("10.72.2.0/24"), undefined, "la rete è nata nonostante il rifiuto");
    });
  });
});

describe("ruoli delle catene vecchie: la famiglia del protocollo (gemelle)", () => {
  for (const [nome, sostituisci] of [["db-tenant", catenaTenant], ["facade", catenaFacciata]] as const) {
    it(`${nome}: linux e ssh accettano la famiglia SSH, snmp anche la v3, windows solo windows`, () => {
      withTenant(T, () => {
        const r = creaRete({ cidr: nome === "facade" ? "10.73.1.0/24" : "10.73.2.0/24", name: `ruoli ${nome}`, description: "", location: "" });
        sostituisci(r.id, "linux", [SSH]);
        sostituisci(r.id, "ssh", [SSH]);
        sostituisci(r.id, "snmp", [SNMP, SNMP_V3]);
        assert.deepEqual(catena(r.id, "linux"), [SSH]);
        assert.deepEqual(catena(r.id, "snmp"), [SNMP, SNMP_V3]);
        assert.throws(() => sostituisci(r.id, "windows", [SSH]), /non valida per ruolo windows/);
      });
    });
  }
});

describe("pin dell'host per ruolo: la famiglia del protocollo (gemelle)", () => {
  const LINUX = 505;
  before(() => withTenant(T, () => voce(LINUX, "linux")));

  for (const [nome, pin, host] of [["db-tenant", pinTenant, 901], ["facade", pinFacciata, 902]] as const) {
    it(`${nome}: ssh accetta anche una vecchia linux, snmp anche la v3, windows no a una ssh`, () => {
      withTenant(T, () => {
        const r = creaRete({ cidr: nome === "facade" ? "10.74.1.0/24" : "10.74.2.0/24", name: `pin ${nome}`, description: "", location: "" });
        dbt().prepare(`INSERT INTO hosts (id, network_id, ip) VALUES (?, ?, ?)`).run(host, r.id, nome === "facade" ? "10.74.1.5" : "10.74.2.5");
        pin(host, "ssh", LINUX);
        pin(host, "snmp", SNMP_V3);
        pin(host, "windows", SSH);
        const pins = dbt().prepare(`SELECT role, credential_id FROM host_detect_credential WHERE host_id = ? ORDER BY role`).all(host);
        assert.deepEqual(pins, [
          { role: "snmp", credential_id: SNMP_V3 },
          { role: "ssh", credential_id: LINUX },
        ]);
      });
    });
  }
});
