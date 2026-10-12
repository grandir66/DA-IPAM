/**
 * INVARIANTE (SEC-5, strada di /api/settings): chi non è admin legge le
 * impostazioni dell'hub senza le chiavi che contengono segreti.
 *
 * Perché (revisione del 12/10, tappa 3): chiusa la configurazione delle
 * integrazioni, GET /api/settings restituiva ancora a qualunque utente tutta la
 * tabella `settings` dell'hub, dove stanno password e token delle integrazioni.
 * Di norma sono cifrati, ma la lettura accetta anche il testo in chiaro delle
 * installazioni precedenti alla cifratura: la stessa integrazione, per un'altra
 * strada.
 *
 * Le chiavi qui sotto sono quelle che il codice scrive davvero nella tabella
 * (valori finti). Le chiavi che le pagine dei viewer leggono devono restare.
 *
 * Run: node --import tsx --test src/lib/permessi/__tests__/impostazioni-viewer.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHIAVE_SEGRETI_NASCOSTI, eImpostazioneSegreta, impostazioniPerRuolo } from "../politica";

const SEGRETE = [
  "integration_librenms_admin_password",
  "integration_librenms_api_token",
  "integration_librenms_secret_db_password",
  "integration_librenms_secret_db_root_password",
  "integration_librenms_secret_app_key",
  "integration_graylog_api_token",
  "integration_graylog_password",
  "integration_graylog_secret_password_secret",
  "integration_loki_api_token",
  "integration_unifi_api_token",
  "integration_unifi_password",
  "integration_wazuh_password_encrypted",
  "integration_wazuh_indexer_password_encrypted",
  "integration_immutable_store_token_encrypted",
  "notify_smtp_password_encrypted",
  "notify_webhook_auth_encrypted",
  "system_github_pat_encrypted",
];

/** Chiavi lette dalle pagine (impostazioni, agenti, scansioni) e dati non segreti. */
const LIBERE = [
  "host_windows_credential_id",
  "host_linux_credential_id",
  "public_hub_url",
  "hub_tailnet_hostname",
  "naabu_bin_path",
  "notify_smtp_host",
  "notify_smtp_user",
  "notify_smtp_port",
  "integration_librenms_mode",
  "integration_librenms_url",
];

const FINTE: Record<string, string> = Object.fromEntries(
  [...SEGRETE, ...LIBERE].map((k, i) => [k, `<finto-${i}>`]),
);

test("eImpostazioneSegreta: riconosce le chiavi dei segreti e lascia le altre", () => {
  for (const k of SEGRETE) assert.equal(eImpostazioneSegreta(k), true, k);
  for (const k of LIBERE) assert.equal(eImpostazioneSegreta(k), false, k);
});

test("impostazioniPerRuolo: il viewer non riceve nessuna chiave segreta, né il suo valore", () => {
  const vista = impostazioniPerRuolo(FINTE, false);
  for (const k of SEGRETE) assert.equal(k in vista, false, `${k} consegnata`);
  const testo = JSON.stringify(vista);
  for (const k of SEGRETE) assert.ok(!testo.includes(FINTE[k]), `valore di ${k} nella risposta`);
  for (const k of LIBERE) assert.equal(vista[k], FINTE[k], k);
  // Il segno che la maschera è passata: la verifica dal di fuori lo legge.
  assert.equal(vista[CHIAVE_SEGRETI_NASCOSTI], String(SEGRETE.length));
});

test("impostazioniPerRuolo: l'admin riceve tutto, la tabella ricevuta non cambia", () => {
  const copia = { ...FINTE };
  assert.deepEqual(impostazioniPerRuolo(FINTE, true), FINTE);
  impostazioniPerRuolo(FINTE, false);
  assert.deepEqual(FINTE, copia);
});

test("GET /api/settings: la risposta passa da impostazioniPerRuolo col ruolo della sessione", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/settings/route.ts"), "utf8");
  const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function PUT"));
  assert.match(get, /impostazioniPerRuolo\(\s*getAllSettings\(\)\s*,\s*puoVedereSegreti\(\s*\w+\.user\.role\s*\)\s*\)/);
  assert.doesNotMatch(get, /NextResponse\.json\(\s*getAllSettings\(\)|NextResponse\.json\(\s*settings\s*\)/);
});
