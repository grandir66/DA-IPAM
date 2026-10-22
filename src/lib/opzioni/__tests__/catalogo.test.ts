// Pagina Opzioni (spec 2026-10-22 §3.1, §5): il catalogo è l'unica fonte della pagina. Una funzione nuova con un
// interruttore che non entra qui resterebbe invisibile, come le 34 levette sparse in 13 pagine del censimento del 22/10:
// questa prova la fa fallire finché non entra nel catalogo, o in fuori-catalogo.ts col perché.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { acquisizioneModulareAccesa, createScheduledJob, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { LETTURE } from "@/lib/topology/letture/interruttori";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduled-job-types";
import { MODULE_DESCRIPTORS } from "@/lib/modules/registry";
import { UNINSTALLABLE_FEATURES } from "@/lib/modules/uninstall-copy";
import { VOCI_DA_AMBIENTE, catalogo, leggiTutte } from "@/lib/opzioni/catalogo";
import { FUORI_CATALOGO } from "@/lib/opzioni/fuori-catalogo";
import type { Opzione } from "@/lib/opzioni/tipi";

const T = "TESTOPZIONICAT";
beforeEach(() => {
  getTenantDb(T).exec("DELETE FROM scheduled_jobs; DELETE FROM networks; DELETE FROM tenant_settings");
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const ids = (): string[] => withTenant(T, () => catalogo().map((o) => o.id));
const fuori = new Set(FUORI_CATALOGO.map((f) => f.chiave));

/**
 * Il censimento del 22/10 (spec §1): ogni interruttore → l'id della sua riga, o la chiave in fuori-catalogo.
 * I job dei controller e i job creati a mano hanno righe che dipendono dai dati: si provano a parte.
 */
const CENSIMENTO: ReadonlyArray<[chiave: string, id: string]> = [
  ...LETTURE.map((l): [string, string] => [`topologia.lettura.${l}`, `lettura.${l}`]),
  ["topologia.mappa.cavi", "automatismo.mappa_cavi"],
  ["patch.choco_automatico", "automatismo.choco_automatico"],
  ["offline_guard_mode", "automatismo.freno_offline"],
  ["acquisizione_modulare.attiva", "automatismo.acquisizione_modulare"],
  ["meshcentral.senza_agente", "automatismo.senza_agente"],
  ["nis2_inventory_enabled", "modulo.nis2_inventory"],
  ["integration_wazuh_enabled", "modulo.wazuh"],
  ["attribution_probes_enabled", "automatismo.sonde_attribuzione"],
  ["networks.probes_enabled", "fuori"],
  ["port_discovery", "automatismo.naabu"],
  ["notify_enabled", "notifiche.attive"],
  ["notify_smtp_enabled", "notifiche.email"],
  ["notify_webhook_enabled", "notifiche.webhook"],
  ["integration_librenms_mode", "modulo.librenms"],
  ["integration_graylog_mode", "modulo.graylog"],
  ["tenant_features.patch_management", "modulo.patch_management"],
  ["tenant_features.inventory_agent", "modulo.inventory_agent"],
  ["tenant_features.meshcentral", "modulo.meshcentral"],
  ["tenant_features.network_services", "modulo.network_services"],
  ["vuln_scanners.enabled", "modulo.edge"],
  ["mdm_config.enabled", "modulo.mdm"],
  ["zabbix_lettura.enabled", "modulo.zabbix"],
  ["controllers.enabled", "fuori"],
  ["hypervisor_sync", "job.hypervisor_sync"],
  ["pulizia_host", "job.pulizia_host"],
  ["dalink.livello", "uscite.dalink_livello"],
  ["tenants.active", "fuori"],
  ["VULCAN_TOKEN", "uscite.vulcan"],
  ["oggetto.env", "uscite.dalink_segnale"],
  ...VOCI_DA_AMBIENTE.map((v): [string, string] => [v.variabile, `file.${v.variabile.toLowerCase()}`]),
  ["DA_INVENT_BACKUP_CRON", "sempre.backup"],
  ["allarme salute", "sempre.allarme_salute"],
  ["allarme job fermi", "sempre.allarme_job_fermi"],
  ["correzioni all'avvio", "sempre.correzioni_avvio"],
];

test("(a) ogni voce del censimento è nel catalogo, o fuori col motivo", () => {
  const presenti = new Set(ids());
  for (const [chiave, id] of CENSIMENTO) {
    if (id === "fuori") assert.ok(fuori.has(chiave), `${chiave}: dichiarata fuori ma manca in fuori-catalogo.ts`);
    else assert.ok(presenti.has(id), `${chiave}: manca la riga ${id}`);
  }
  for (const f of FUORI_CATALOGO) assert.ok(f.motivo.length > 10, `${f.chiave}: motivo mancante`);
  assert.equal(VOCI_DA_AMBIENTE.length + 2, 11, "11 voci da file: 9 variabili, il gettone di DA-Vul-can, il file di DA-Link");
});

test("(a) ogni lettura di LETTURE ha la sua riga: una lettura nuova senza riga fa fallire", () => {
  const presenti = new Set(ids());
  for (const l of LETTURE) assert.ok(presenti.has(`lettura.${l}`), l);
});

test("(a) ogni modulo del registry e ogni modulo installabile è nel catalogo, o fuori col motivo", () => {
  const presenti = new Set(ids());
  for (const d of MODULE_DESCRIPTORS) {
    assert.ok(presenti.has(`modulo.${d.key}`) || fuori.has(`modulo.${d.key}`), `modulo ${d.key}`);
  }
  for (const k of UNINSTALLABLE_FEATURES) {
    const o = withTenant(T, () => catalogo().find((x) => x.id === `modulo.${k}`));
    assert.equal(o?.forma, "modulo", k);
    assert.ok(o?.cambia, `${k}: si installa da Opzioni`);
  }
});

test("(a) ogni tipo di job ha una riga: per tipo, per controller, o per job", () => {
  withTenant(T, () => {
    const creati = new Map<string, number>();
    for (const tipo of SCHEDULED_JOB_TYPES) {
      if (tipo === "unifi_sync") continue;
      creati.set(tipo, createScheduledJob({ job_type: tipo, interval_minutes: 60, network_id: null }).id);
    }
    const presenti = new Set(catalogo().map((o) => o.id));
    for (const [tipo, id] of creati) {
      assert.ok(presenti.has(`job.${tipo}`) || presenti.has(`job.${id}`), `job ${tipo}`);
    }
    // unifi_sync: le righe sono per controller; senza controller c'è la riga che chiede di aggiungerlo.
    assert.ok(presenti.has("controller.nessuno"));
  });
});

test("(b) id unici, e stabili quelli a cui puntano i rimandi delle pagine vecchie", () => {
  const tutti = ids();
  assert.equal(new Set(tutti).size, tutti.length, "id doppi");
  for (const id of [
    "lettura.mikrotik", "lettura.mikrotik_scheda", "lettura.switch_vlan", "lettura.snmp", "lettura.controller", "lettura.host",
    "automatismo.mappa_cavi", "job.hypervisor_sync", "job.pulizia_host", "job.arp_poll", "job.dns_resolve", "job.fast_scan",
    "job.known_host_check", "modulo.nis2_inventory", "modulo.patch_management", "modulo.inventory_agent", "modulo.meshcentral",
    "modulo.network_services", "modulo.zabbix", "modulo.mdm", "automatismo.choco_automatico", "automatismo.senza_agente",
    "automatismo.naabu", "notifiche.attive", "notifiche.email", "notifiche.webhook", "uscite.dalink_livello",
  ]) {
    assert.ok(tutti.includes(id), id);
  }
});

test("(c) una `leggi` che lancia dà la riga d'errore col codice, e le altre righe restano", async () => {
  const rotta: Opzione = {
    id: "prova.rotta", gruppo: "automatismi", nome: "rotta", cosa: "", valePer: "cliente", forma: "levetta", diSerie: "",
    leggi() { throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" }); },
  };
  const buona: Opzione = { ...rotta, id: "prova.buona", leggi: () => ({ acceso: true, da: null, il: null, esito: { tipo: "ok", testo: "ok" } }) };
  const righe = await leggiTutte([rotta, buona]);
  assert.deepEqual(righe[0].stato, { acceso: null, da: null, il: null, esito: { tipo: "errore", testo: "stato illeggibile (SQLITE_BUSY)" } });
  assert.equal(righe[1].stato.acceso, true);
});

test("(d) cliente appena nato: le sei letture accese di serie (librenms spenta: scrive in LibreNMS), la mappa nuova spenta, nessuna riga illeggibile", async () => {
  await withTenant(T, async () => {
    const righe = await leggiTutte();
    const per = (id: string) => righe.find((r) => r.opzione.id === id)?.stato;
    for (const l of LETTURE) assert.deepEqual([per(`lettura.${l}`)?.acceso, per(`lettura.${l}`)?.da], [l !== "librenms", null], l);
    assert.equal(per("automatismo.mappa_cavi")?.acceso, false);
    const illeggibili = righe.filter((r) => r.stato.esito.testo.startsWith("stato illeggibile")).map((r) => `${r.opzione.id}: ${r.stato.esito.testo}`);
    assert.deepEqual(illeggibili, []);
  });
});

test("(e) acquisizione modulare: spenta di serie, si accende e si spegne da Opzioni, scrive la stessa impostazione di prima", async () => {
  await withTenant(T, async () => {
    const o = catalogo().find((x) => x.id === "automatismo.acquisizione_modulare");
    assert.ok(o, "riga mancante");
    assert.equal(o.forma, "levetta");
    assert.equal(o.valePer, "cliente");
    assert.equal((await o.leggi()).acceso, false);
    o.cambia?.({ acceso: true }, "test");
    assert.equal((await o.leggi()).acceso, true);
    assert.equal(acquisizioneModulareAccesa(), true, "è la stessa impostazione letta dal pulsante d'acquisizione");
    o.cambia?.({ acceso: false }, "test");
    assert.equal((await o.leggi()).acceso, false);
    assert.equal(acquisizioneModulareAccesa(), false);
    assert.throws(() => o.cambia?.({}, "test"), /accendere o spegnere/);
  });
});
