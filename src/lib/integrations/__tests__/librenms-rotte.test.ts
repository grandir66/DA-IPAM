// Rotte di LibreNMS come fonte di dati (piano 2026-10-22 LibreNMS, task 5): i corpi, senza sessione (la guardia la provano
// `rotte-censite` e `scripts/verifica-permessi.sh`). Dati scritti con lo stesso codice del giro sulle fixture vere.
//
// Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/integrations/__tests__/librenms-rotte.test.ts
import { removeTestHubDb } from "./support/hub-isolato";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { leggiApparati, leggiPorte, leggiSensori } from "../librenms-lettori";
import { scriviParteLibrenms } from "../librenms-fonte";
import { scriviInterruttore } from "../../topology/letture/interruttori";
import { rispostaAggiungiCandidato, rispostaCandidati, rispostaDatiHost } from "../librenms-rotte";

const T = "TESTLIBRENMSROTTE";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const FIX = path.join(__dirname, "fixtures", "librenms");
const vera = (f: string): unknown => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const H: { ccr: number; nudo: number } = { ccr: 0, nudo: 0 };

before(() => {
  const d = getTenantDb(T);
  d.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '192.0.2.0/24', 'rete-a')").run();
  const host = (ip: string): number => Number(d.prepare("INSERT INTO hosts (network_id, ip, hostname) VALUES (1, ?, ?)").run(ip, `h-${ip}`).lastInsertRowid);
  H.ccr = host("192.0.2.3");
  H.nudo = host("192.0.2.77");
  withTenant(T, () => {
    scriviParteLibrenms("apparati", leggiApparati(vera("devices.json")), "2026-10-22 08:00:00");
    scriviParteLibrenms("porte", leggiPorte(vera("ports.json")), "2026-10-22 08:00:00");
    scriviParteLibrenms("sensori", leggiSensori(vera("sensors.json")), "2026-10-22 08:00:00");
  });
});

test("dati dell'host: id non valido 400, host assente 404, non abbinato, abbinato", () => {
  withTenant(T, () => {
    assert.equal(rispostaDatiHost("x").status, 400);
    assert.equal(rispostaDatiHost("99999").status, 404);
    const nudo = rispostaDatiHost(String(H.nudo));
    assert.equal(nudo.status, 200);
    assert.equal((nudo.corpo as { abbinato: boolean }).abbinato, false);
    const ccr = rispostaDatiHost(String(H.ccr));
    const c = ccr.corpo as { abbinato: boolean; librenms_device_id: number; letture: Record<string, { esito: string }> };
    assert.equal(c.abbinato, true);
    assert.equal(c.librenms_device_id, 5);
    assert.equal(c.letture.apparati.esito, "letto");
    assert.equal(c.letture.vicini.esito, "mai", "parte mai letta: si dice");
    assert.equal((ccr.corpo as { acceso: boolean }).acceso, false, "interruttore non acceso = spento: la scheda ignora i dati");
    assert.equal((nudo.corpo as { acceso: boolean }).acceso, false);
    scriviInterruttore("librenms", true, "test");
    assert.equal((rispostaDatiHost(String(H.ccr)).corpo as { acceso: boolean }).acceso, true);
    scriviInterruttore("librenms", false, "test");
  });
});

test("candidati: le tre liste e lo stato per parte", () => {
  withTenant(T, () => {
    const r = rispostaCandidati();
    assert.equal(r.status, 200);
    const c = r.corpo as { non_interrogati: unknown[]; rifiutati: unknown[]; dai_vicini: unknown[]; letture: Record<string, unknown> };
    assert.equal(c.non_interrogati.length, 3);
    assert.deepEqual(c.rifiutati, []);
    assert.deepEqual(c.dai_vicini, [], "senza vicini letti nessun candidato");
    assert.deepEqual(Object.keys(c.letture).sort(), ["apparati", "arp", "inventario", "mac_porta", "porte", "sensori", "vicini", "vlan"]);
  });
});

test("aggiunta di un candidato: corpo non valido 400, host assente 404, rifiuto 422 col codice, riuscita 200", async () => {
  await withTenant(T, async () => {
    assert.equal((await rispostaAggiungiCandidato({ host_id: "1" })).status, 400);
    assert.equal((await rispostaAggiungiCandidato({ host_id: 1, altro: true })).status, 400);
    assert.equal((await rispostaAggiungiCandidato({ host_id: 99999 })).status, 404);
    const no = await rispostaAggiungiCandidato({ host_id: H.nudo }, async () => ({ ok: false, codice: "snmp_non_risponde", messaggio: "Could not connect" }));
    assert.deepEqual(no, { status: 422, corpo: { error: "LibreNMS ha rifiutato l'aggiunta: Could not connect", codice: "snmp_non_risponde" } });
    const si = await rispostaAggiungiCandidato({ host_id: H.nudo }, async () => ({ ok: true, librenms_device_id: 60, aggiunto: true }));
    assert.deepEqual(si, { status: 200, corpo: { librenms_device_id: 60, added: true } });
  });
});
