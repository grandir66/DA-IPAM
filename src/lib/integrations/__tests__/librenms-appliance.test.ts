/**
 * LibreNMS messo in Docker dall'installatore dell'appliance: la scheda lo dice
 * e «Installa» non ne crea un secondo.
 *
 * Incidente (pilota PX-NAS, 2026-10-15): la scheda chiamava «Istanza esterna» il
 * LibreNMS che stava sulla stessa macchina; sembrava che mancasse, e il pulsante
 * «Installa» ha avviato un secondo LibreNMS (`da-librenms`, porta 8090, vuoto)
 * che a fine lavoro avrebbe preso il posto di quello dell'installatore.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTENITORE_LIBRENMS_APPLIANCE,
  RIFIUTO_SECONDO_LIBRENMS,
  librenmsDellAppliance,
  rifiutoInstallazione,
} from "@/lib/integrations/librenms-appliance";
import { vistaScheda, type StatoScheda } from "@/lib/integrations/scheda-integrazione";
import { getContainerStatus } from "@/lib/integrations/docker";

/**
 * Doppio di `docker inspect --format` su un contenitore SENZA controllo di
 * salute, come `appliance-librenms`: per il template Go `.State.Health` non
 * esiste, e chiedere `{{.State.Health.Status}}` fa uscire inspect con 1
 * («map has no entry for key "Health"»). Solo la forma con la guardia `if` passa.
 * Visto sulla VM del pilota il 2026-10-15: la scheda diceva «contenitore assente».
 */
async function inspectSenzaSalute(args: string[]) {
  const formato = args[args.indexOf("--format") + 1] ?? "";
  const senzaGuardia = formato.replace(/\{\{if \.State\.Health\}\}\{\{\.State\.Health\.Status\}\}\{\{end\}\}/g, "");
  if (senzaGuardia.includes(".State.Health")) {
    throw new Error('template parsing error: map has no entry for key "Health"');
  }
  return { stdout: "true|librenms/librenms:25.5.0|2026-10-15T10:43:23Z|\n", stderr: "" };
}

test("stato di un contenitore senza controllo di salute → acceso, salute vuota (non «assente»)", async () => {
  const s = await getContainerStatus("appliance-librenms", inspectSenzaSalute);
  assert.deepEqual(s, { running: true, image: "librenms/librenms:25.5.0", uptime: "2026-10-15T10:43:23Z", health: "" });
});

test("LibreNMS dell'appliance riconosciuto con lo stato vero del contenitore", async () => {
  const stato = (nome: string) => getContainerStatus(nome, inspectSenzaSalute);
  assert.equal(await librenmsDellAppliance(stato), true);
});

const acceso = { running: true, image: "librenms/librenms:25.5.0", uptime: "", health: "" };

test("contenitore dell'installatore presente → LibreNMS dell'appliance", async () => {
  const chiesti: string[] = [];
  const stato = async (nome: string) => { chiesti.push(nome); return acceso; };
  assert.equal(await librenmsDellAppliance(stato), true);
  assert.deepEqual(chiesti, [CONTENITORE_LIBRENMS_APPLIANCE]);
});

test("contenitore assente (o Docker muto) → non è dell'appliance", async () => {
  assert.equal(await librenmsDellAppliance(async () => null), false);
});

test("Installa LibreNMS con quello dell'appliance presente → rifiutato, e il motivo si legge", async () => {
  const motivo = await rifiutoInstallazione("librenms", async () => acceso);
  assert.equal(motivo, RIFIUTO_SECONDO_LIBRENMS);
  assert.match(motivo ?? "", /già installato dall'appliance/);
});

test("Installa LibreNMS senza quello dell'appliance → si procede", async () => {
  assert.equal(await rifiutoInstallazione("librenms", async () => null), null);
});

test("Installa Graylog o Loki → il contenitore di LibreNMS non conta", async () => {
  let chiesto = false;
  const stato = async () => { chiesto = true; return acceso; };
  assert.equal(await rifiutoInstallazione("graylog", stato), null);
  assert.equal(await rifiutoInstallazione("loki", stato), null);
  assert.equal(chiesto, false);
});

const base: StatoScheda = {
  dallAppliance: false,
  dockerAvailable: true,
  managed: true,
  installing: false,
  containerRunning: false,
};

test("scheda con LibreNMS dell'appliance: lo dice, niente Docker locale, niente Installa", () => {
  const v = vistaScheda({ ...base, dallAppliance: true });
  assert.equal(v.etichettaEsterna, "Installato dall'appliance");
  assert.equal(v.badgeEsterno, "Installato dall'appliance");
  assert.equal(v.dockerLocaleSelezionabile, false);
  assert.match(v.notaDockerLocale, /appliance/);
  assert.equal(v.mostraInstalla, false);
});

test("scheda senza LibreNMS dell'appliance: come prima", () => {
  const v = vistaScheda(base);
  assert.equal(v.etichettaEsterna, "Istanza esterna");
  assert.equal(v.badgeEsterno, "Esterno");
  assert.equal(v.dockerLocaleSelezionabile, true);
  assert.equal(v.notaDockerLocale, "");
  assert.equal(v.mostraInstalla, true);
});

test("Installa resta nascosto se Docker manca, se installa già o se il contenitore gira", () => {
  assert.equal(vistaScheda({ ...base, dockerAvailable: false }).mostraInstalla, false);
  assert.equal(vistaScheda({ ...base, dockerAvailable: false }).notaDockerLocale, " (Docker non disponibile)");
  assert.equal(vistaScheda({ ...base, installing: true }).mostraInstalla, false);
  assert.equal(vistaScheda({ ...base, containerRunning: true }).mostraInstalla, false);
  assert.equal(vistaScheda({ ...base, managed: false }).mostraInstalla, false);
});
