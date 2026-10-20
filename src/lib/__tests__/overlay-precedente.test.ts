/**
 * Overlay precedente tolto dal codice (20/10/2026): l'overlay è solo NetBird, governato
 * da DA-Link.
 *
 * - Le API del caveau accettano solo i tipi in elenco; quello dell'overlay precedente non
 *   si crea più (sul live 0 righe), ma una riga vecchia di un tipo tolto si legge ancora:
 *   niente migrazione che cancella.
 * - L'indirizzo dell'hub viene solo da `public_hub_url` (poi ambiente e richiesta): il nome
 *   dell'hub nell'overlay precedente non lo decide più e non nasce più nei DB nuovi; la riga
 *   resta nei DB vecchi (niente DROP), nessuno la legge.
 *
 * Hub DB isolato: `support/hub-isolato` va importato PER PRIMO (il perché sta lì).
 */
import { removeTestHubDb } from "../integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, getHubDb, setSetting } from "@/lib/db-hub";
import { getCredential, listCredentials } from "@/lib/credentials-vault";
import { TIPI_CREDENZIALE, TipoCredenzialeSchema } from "@/lib/credentials-vault-tipi";
import { resolvePublicHubOrigin, urlHubConfigurato } from "@/lib/inventory-agent/public-url";

const ENV = ["DA_IPAM_PUBLIC_URL", "DA_INVENT_PUBLIC_HOST", "APPLIANCE_PUBLIC_HOST", "APPLIANCE_LAN_IP", "APPLIANCE_HOST", "NEXTAUTH_URL"];

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  setSetting("public_hub_url", "");
});

after(() => {
  closeHubDb();
  removeTestHubDb();
});

/** Chiavi `hub_*` delle impostazioni di un DB dell'hub. */
function chiaviHub(): string[] {
  return (getHubDb().prepare("SELECT key FROM settings WHERE key LIKE 'hub\\_%' ESCAPE '\\' ORDER BY key").all() as { key: string }[]).map((r) => r.key);
}

test("le API del caveau accettano solo questi tipi di credenziale", () => {
  assert.deepEqual([...TIPI_CREDENZIALE], ["wazuh", "graylog", "librenms", "truenas", "edge", "hub", "pve", "other"]);
  assert.equal(TipoCredenzialeSchema.safeParse("vpn-qualunque").success, false);
});

test("una riga vecchia di un tipo non più in elenco si legge ancora, senza errori", () => {
  const db = getHubDb();
  const id = Number(
    db.prepare("INSERT INTO system_credentials (kind, label) VALUES ('tipo-tolto', 'Credenziale vecchia')").run().lastInsertRowid,
  );
  const riga = listCredentials().find((c) => c.id === id);
  assert.ok(riga, "la riga vecchia non compare nell'elenco");
  assert.equal(riga.kind, "tipo-tolto");
  assert.equal(riga.has_password, false);
  assert.equal(getCredential(id)?.label, "Credenziale vecchia");
  db.prepare("DELETE FROM system_credentials WHERE id = ?").run(id);
});

test("un DB nuovo dell'hub non crea più impostazioni `hub_*` per l'indirizzo dell'hub", () => {
  assert.deepEqual(chiaviHub(), []);
});

test("l'indirizzo dell'hub viene solo da public_hub_url: nessun'altra impostazione `hub_*` lo decide", () => {
  for (const k of [...chiaviHub(), "hub_hostname", "hub_overlay_hostname"]) setSetting(k, "da-invent");
  process.env.DA_INVENT_PUBLIC_HOST = "192.0.2.10";
  const r = resolvePublicHubOrigin(new Request("https://192.0.2.99/api/x"));
  assert.equal(r.source, "env_host");
  assert.equal(r.origin, "https://192.0.2.10");

  assert.deepEqual(urlHubConfigurato(), { public_hub_url: "", effective_url: null, source: "none" });
  setSetting("public_hub_url", "https://ipam.esempio.invalid/");
  assert.deepEqual(urlHubConfigurato(), {
    public_hub_url: "https://ipam.esempio.invalid/",
    effective_url: "https://ipam.esempio.invalid",
    source: "public_hub_url",
  });
});
