/**
 * Ricerca della credenziale con `prova` finta (tappe 3-5, T3, 21/10).
 *
 * Incidenti: la «Prova» a mano non registrava i fallimenti (senza traccia nessuna credenziale poteva risultare
 * «esclusa»); su un host Windows con 5 candidate si rischiava di provarle tutte e bloccare l'account.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/credentials/__tests__/trova.test.ts
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-trova";

import { candidatiPerHost, trovaCredenziale, registraProva, eErroreDiTrasporto, TETTO_WINDOWS } from "../trova";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";

const T = "TESTTROVACRED";
const q = <R,>(sql: string, ...a: unknown[]) => getTenantDb(T).prepare(sql).all(...a) as R[];

describe("trovaCredenziale", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare(`INSERT INTO networks (id, cidr, name) VALUES (1, '10.50.0.0/24', 'prova')`).run();
      d.prepare(`INSERT INTO hosts (id, network_id, ip) VALUES (1, 1, '10.50.0.5')`).run();
      const ins = d.prepare(`INSERT INTO credentials (id, name, credential_type) VALUES (?, ?, ?)`);
      // ssh: 1 archivio, 2 lista rete (seconda), 3 lista rete (prima), 4 validata sull'host, 5 un tipo che non c'entra
      ins.run(1, "ssh archivio", "ssh");
      ins.run(2, "ssh rete B", "ssh");
      ins.run(3, "ssh rete A", "linux");
      ins.run(4, "ssh validata", "ssh");
      ins.run(5, "community", "snmp");
      // windows: 11..15
      for (let i = 11; i <= 15; i++) ins.run(i, `win ${i}`, "windows");
      ins.run(20, "account AD", "ad");
    });
  });
  after(() => deleteTenantDatabase(T));
  beforeEach(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare(`DELETE FROM host_credentials`).run();
      d.prepare(`DELETE FROM network_credentials`).run();
      d.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (1, 3, 0), (1, 2, 1)`).run();
      d.prepare(`INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (1, 4, 'ssh', 22, 1)`).run();
    });
  });

  it("ordine: validate sull'host, lista della rete, resto dell'archivio; senza doppioni, solo tipi giusti", () => {
    const c = withTenant(T, () => candidatiPerHost(getTenantDb(T), 1, "ssh", 22));
    assert.deepEqual(c.map((x) => x.credentialId), [4, 3, 2, 1]);
  });

  it("l'account AD non è mai candidato, nemmeno per WinRM", () => {
    const c = withTenant(T, () => candidatiPerHost(getTenantDb(T), 1, "winrm", 5985));
    assert.deepEqual(c.map((x) => x.credentialId), [11, 12, 13, 14, 15]);
  });

  it("si ferma alla prima riuscita e registra fallimenti e successo", async () => {
    const chiamate: number[] = [];
    const r = await withTenant(T, () =>
      trovaCredenziale(getTenantDb(T), 1, "ssh", 22, async (id) => {
        chiamate.push(id);
        return id === 3 ? { ok: true } : { ok: false, errore: "rifiutata" };
      }),
    );
    assert.deepEqual(chiamate, [4, 3]);
    assert.deepEqual(r.trovata, { credentialId: 3, nome: "ssh rete A" });
    assert.deepEqual(r.tentativi.map((t) => t.esito), ["rifiutata", "riuscita"]);
    assert.match(r.tentativi[0].quando, /^\d{4}-\d\d-\d\dT.*Z$/);
    const righe = withTenant(T, () => q<{ credential_id: number; validated: number; last_error: string | null }>(`SELECT credential_id, validated, last_error FROM host_credentials ORDER BY credential_id`));
    assert.deepEqual(righe.map((x) => [x.credential_id, x.validated, x.last_error]), [[3, 1, null], [4, 0, "rifiutata"]]);
  });

  it("una fallita è esclusa alla ricerca dopo: non si riprova e si dice con la data", async () => {
    withTenant(T, () => registraProva(1, 4, "ssh", 22, { ok: false, errore: "password errata" }));
    const chiamate: number[] = [];
    const r = await withTenant(T, () =>
      trovaCredenziale(getTenantDb(T), 1, "ssh", 22, async (id) => {
        chiamate.push(id);
        return { ok: false, errore: "no" };
      }),
    );
    assert.deepEqual(chiamate, [3, 2, 1]);
    const esclusa = r.tentativi.find((t) => t.credentialId === 4)!;
    assert.equal(esclusa.esito, "esclusa");
    assert.match(esclusa.motivo!, /password errata/);
    assert.match(esclusa.motivo!, new RegExp(new Date().toISOString().slice(0, 10)));
    assert.equal(r.trovata, null);
  });

  it("una «Prova» a mano riuscita rimette in gioco la esclusa", () => {
    withTenant(T, () => registraProva(1, 4, "ssh", 22, { ok: false, errore: "x" }));
    assert.ok(withTenant(T, () => candidatiPerHost(getTenantDb(T), 1, "ssh", 22)).find((c) => c.credentialId === 4)!.esclusa);
    withTenant(T, () => registraProva(1, 4, "ssh", 22, { ok: true }));
    assert.equal(withTenant(T, () => candidatiPerHost(getTenantDb(T), 1, "ssh", 22)).find((c) => c.credentialId === 4)!.esclusa, null);
  });

  it("Windows con 5 candidate: 3 tentativi veri rifiutati, 2 fermate", async () => {
    let chiamate = 0;
    const r = await withTenant(T, () =>
      trovaCredenziale(getTenantDb(T), 1, "winrm", 5985, async () => {
        chiamate++;
        return { ok: false, errore: "accesso negato" };
      }),
    );
    assert.equal(TETTO_WINDOWS, 3);
    assert.equal(chiamate, 3);
    assert.deepEqual(r.tentativi.map((t) => t.esito), ["rifiutata", "rifiutata", "rifiutata", "fermata", "fermata"]);
    assert.match(r.tentativi[3].motivo!, /3 tentativi/);
    assert.equal(r.trovata, null);
  });

  it("le escluse non contano nel tetto di Windows", async () => {
    withTenant(T, () => registraProva(1, 11, "winrm", 5985, { ok: false, errore: "x" }));
    let chiamate = 0;
    const r = await withTenant(T, () =>
      trovaCredenziale(getTenantDb(T), 1, "winrm", 5985, async () => {
        chiamate++;
        return { ok: false, errore: "no" };
      }),
    );
    assert.equal(chiamate, 3);
    assert.deepEqual(r.tentativi.map((t) => t.esito), ["esclusa", "rifiutata", "rifiutata", "rifiutata", "fermata"]);
  });

  it("una prova che lancia un errore è una rifiutata, non interrompe la ricerca", async () => {
    const r = await withTenant(T, () =>
      trovaCredenziale(getTenantDb(T), 1, "ssh", 22, async (id) => {
        if (id === 4) throw new Error("socket chiuso");
        return { ok: id === 3 };
      }),
    );
    assert.equal(r.tentativi[0].esito, "rifiutata");
    assert.equal(r.tentativi[0].motivo, "socket chiuso");
    assert.equal(r.trovata?.credentialId, 3);
  });

  it("segreto mancante: «fermata», niente traccia sull'host, non conta nel tetto", async () => {
    // validata sull'host → prima in coda; poi le cinque normali (la voce si toglie a fine prova)
    withTenant(T, () => getTenantDb(T).prepare(`INSERT INTO credentials (id, name, credential_type) VALUES (16, 'senza segreto', 'windows')`).run());
    withTenant(T, () => getTenantDb(T).prepare(`INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (1, 16, 'winrm', 5985, 1)`).run());
    const r = await withTenant(T, () =>
      trovaCredenziale(getTenantDb(T), 1, "winrm", 5985, async (id) =>
        id === 16 ? { ok: false, errore: "Username e password richiesti", nonProvata: true } : { ok: false, errore: "no" },
      ),
    );
    assert.equal(r.tentativi.find((t) => t.credentialId === 16)!.esito, "fermata");
    assert.equal(r.tentativi.filter((t) => t.esito === "rifiutata").length, 3);
    const n = withTenant(T, () => q<{ last_error: string | null }>(`SELECT last_error FROM host_credentials WHERE credential_id = 16`));
    assert.deepEqual(n.map((x) => x.last_error), [null]); // solo la riga di partenza, nessun fallimento scritto
    withTenant(T, () => getTenantDb(T).prepare(`DELETE FROM credentials WHERE id = 16`).run());
  });
  it("host non raggiungibile: la ricerca si ferma subito, niente rifiutata né traccia sull'host", async () => {
    const chiamate: number[] = [];
    const r = await withTenant(T, () =>
      trovaCredenziale(getTenantDb(T), 1, "ssh", 22, async (id) => {
        chiamate.push(id);
        return { ok: false, errore: "connect ETIMEDOUT", trasporto: true };
      }),
    );
    assert.equal(chiamate.length, 1, "una sola prova, poi stop");
    assert.deepEqual(r.tentativi.map((t) => t.esito), ["fermata"]);
    assert.match(r.tentativi[0].motivo!, /host non raggiungibile/i);
    assert.equal(r.trovata, null);
    const righe = withTenant(T, () => q<{ last_error: string | null }>(`SELECT last_error FROM host_credentials WHERE last_error IS NOT NULL`));
    assert.deepEqual(righe, [], "nessun fallimento registrato: nessuna credenziale esclusa");
  });

  it("escludi: le credenziali già rifiutate 3 volte nel giro sono «fermate» su questo host, senza prova", async () => {
    const chiamate: number[] = [];
    const r = await withTenant(T, () =>
      trovaCredenziale(
        getTenantDb(T), 1, "winrm", 5985,
        async (id) => {
          chiamate.push(id);
          return { ok: false, errore: "no" };
        },
        { escludi: [11, 12] },
      ),
    );
    assert.deepEqual(chiamate, [13, 14, 15]);
    const f = r.tentativi.filter((t) => t.credentialId === 11 || t.credentialId === 12);
    assert.deepEqual(f.map((t) => t.esito), ["fermata", "fermata"]);
    assert.match(f[0].motivo!, /già rifiutato 3 volte in questo giro/);
  });

  it("eErroreDiTrasporto: timeout/rifiuto/irraggiungibile sì, password sbagliata no; SNMP: il timeout è ambiguo", () => {
    assert.equal(eErroreDiTrasporto("ssh", "x", "connect_timeout"), true);
    assert.equal(eErroreDiTrasporto("ssh", "x", "connect_refused"), true);
    assert.equal(eErroreDiTrasporto("ssh", "x", "unreachable"), true);
    assert.equal(eErroreDiTrasporto("ssh", "Autenticazione fallita", "auth_failed"), false);
    assert.equal(eErroreDiTrasporto("winrm", "Timeout: nessuna risposta entro 25 secondi"), true);
    assert.equal(eErroreDiTrasporto("winrm", "connect EHOSTUNREACH 10.0.0.1:5985"), true);
    assert.equal(eErroreDiTrasporto("winrm", "401 Unauthorized: credentials were rejected"), false);
    assert.equal(eErroreDiTrasporto("snmp", "Connessione SNMP fallita (Request timed out)"), false);
    assert.equal(eErroreDiTrasporto("snmp", "Connessione SNMP fallita (connect EHOSTUNREACH)"), true);
  });
});
