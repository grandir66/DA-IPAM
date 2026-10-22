/**
 * «Reset per nuovo cliente» dentro un tenant — analisi del 19/10, F02.
 *
 * Incidente: POST /api/reset chiamava la gemella di `db.ts`, che nel contesto
 * di un tenant lavora sul DB del tenant ma fa anche `DELETE FROM users` (tabella
 * dell'hub): «no such table: users», rollback, e il pulsante non ha mai
 * funzionato su un'installazione vera. La gemella di `db-tenant.ts` c'era, ma la
 * rotta non la chiamava.
 *
 * Regola decisa da Riccardo il 19/10: il reset toglie dati di rete, credenziali,
 * inventario e job; restano le impostazioni del cliente e gli utenti dell'hub.
 *
 * Run: node --import tsx --test src/lib/__tests__/reset-nuovo-cliente.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { resetConfiguration as resetFacciata } from "@/lib/db";
import { closeHubDb, createUser, getHubDb, getSetting, setSetting } from "@/lib/db-hub";
import { resetLabNetworkConfig, TABELLE_TENUTE } from "@/lib/lab-config-reset";

const conta = (t: string, code: string): number =>
  (getTenantDb(code).prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

function riempi(code: string): void {
  const d = getTenantDb(code);
  const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.91.0.0/24', 'Rete sentinella')").run().lastInsertRowid);
  d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.91.0.5')").run(rete);
  d.prepare("INSERT INTO credentials (name, credential_type) VALUES ('Voce sentinella', 'ssh')").run();
  d.prepare("INSERT INTO tenant_settings (key, value) VALUES ('sentinella', 'resta')").run();
}

function impostazione(code: string): string | undefined {
  return (getTenantDb(code).prepare("SELECT value FROM tenant_settings WHERE key = 'sentinella'").get() as { value: string } | undefined)?.value;
}

const T1 = "F02FACCIATA";
const T2 = "F02ROTTA";
const T3 = "F02TUTTO";

describe("reset per nuovo cliente dentro un tenant", () => {
  after(() => {
    for (const t of [T1, T2, T3]) {
      try { closeTenantDb(t); deleteTenantDatabase(t); } catch { /* già tolto */ }
    }
    closeHubDb();
  });

  it("la gemella di db.ts nel contesto di un tenant riesce: via i dati, restano impostazioni e utenti", () => {
    createUser("utente-sentinella-1", "x", "admin");
    withTenant(T1, () => {
      riempi(T1);
      assert.doesNotThrow(() => resetFacciata());
      assert.equal(conta("networks", T1), 0);
      assert.equal(conta("hosts", T1), 0);
      assert.equal(conta("credentials", T1), 0);
      assert.equal(impostazione(T1), "resta");
    });
    assert.ok(getHubDb().prepare("SELECT 1 FROM users WHERE username = 'utente-sentinella-1'").get());
  });

  it("la funzione della rotta (la stessa del reset del laboratorio): via i dati, restano impostazioni e utenti", () => {
    createUser("utente-sentinella-2", "x", "admin");
    withTenant(T2, () => riempi(T2));
    const esito = resetLabNetworkConfig(T2);
    assert.equal(esito.tenantCode, T2);
    withTenant(T2, () => {
      assert.equal(conta("networks", T2), 0);
      assert.equal(conta("credentials", T2), 0);
      assert.equal(impostazione(T2), "resta");
    });
    assert.ok(getHubDb().prepare("SELECT 1 FROM users WHERE username = 'utente-sentinella-2'").get());
  });

  // Revisione del 19/10: le due liste di cancellazione lasciavano controller di rete (con le
  // password), telefoni, agenti Wazuh, vulnerabilità, apparati fisici e topologia del cliente
  // di prima. Ora resta solo ciò che è dichiarato in TABELLE_TENUTE: lo si prova su TUTTE le
  // tabelle del tenant, non su un elenco scelto a mano.
  it("tutte le tabelle del tenant restano vuote tranne quelle tenute, che restano com'erano", () => {
    const d = withTenant(T3, () => getTenantDb(T3));
    const riga = (t: string): void => {
      const cols = (d.prepare(`PRAGMA table_info("${t}")`).all() as { name: string; notnull: number; dflt_value: unknown; pk: number; type: string }[])
        .filter((c) => c.notnull && c.dflt_value == null && !c.pk);
      const v = cols.map((c) => (/INT|REAL/i.test(c.type) ? 1 : `x-${c.name}`));
      d.prepare(`INSERT INTO "${t}" (${cols.map((c) => `"${c.name}"`).join(",") || "rowid"}) VALUES (${cols.map(() => "?").join(",") || "NULL"})`).run(...v);
    };
    const tabelle = (d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
    d.pragma("foreign_keys = OFF");
    const riempite: string[] = [];
    for (const t of tabelle) {
      try { riga(t); riempite.push(t); } catch { /* vincoli particolari: la tabella resta vuota */ }
    }
    d.pragma("foreign_keys = ON");
    for (const t of ["network_controllers", "mobile_devices", "wazuh_agent", "vuln_findings", "physical_devices", "mc_config"]) {
      assert.ok(riempite.includes(t), `la prova deve riempire ${t}`);
    }
    const prima = Object.fromEntries(TABELLE_TENUTE.filter((t) => tabelle.includes(t)).map((t) => [t, conta(t, T3)]));

    setSetting("onboarding_completed", "1");
    resetLabNetworkConfig(T3);

    const rimaste = tabelle.filter((t) => !TABELLE_TENUTE.includes(t) && conta(t, T3) > 0);
    assert.deepEqual(rimaste, []);
    for (const [t, n] of Object.entries(prima)) assert.equal(conta(t, T3), n, `${t} deve restare com'era`);
    // Il wizard si riapre per questo tenant, non per tutta l'installazione.
    assert.equal(getSetting(`onboarding_completed:${T3}`), "0");
    assert.equal(getSetting("onboarding_completed"), "1");
  });
});
