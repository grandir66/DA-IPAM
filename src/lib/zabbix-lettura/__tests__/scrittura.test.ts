// «Metti in monitoraggio» (13/11/2026, tappa C di DATIA MONITORING): la chiave di scrittura
// sta a parte e ha la sua forma, il corpo porta solo i campi pieni, gli esiti del centro
// si leggono col loro schema e gli errori col testo nostro. Il centro è finto.
process.env.ENCRYPTION_KEY ||= "chiave-di-prova-del-pannello-zabbix";
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
import { chiaveScrittura, leggiConfigScrittura, salvaChiaveScrittura, salvaConfigLettura, togliChiaveScrittura } from "../config";
import { inserisciHost, oggettoDaHost, perchéNonSiPuò } from "../inserimento";
import { corpoScrittura, mettiInMonitoraggio } from "../scrittura";
import { ErroreLettura, type TrasportoPost } from "../trasporto";

const LETTURA = `zl1.a1b2c3d4.${"C".repeat(43)}`;
const SCRITTURA = `zs1.0a0b0c0d.${"S".repeat(43)}`;
const BASE = new URL("https://centro.example/wizard");

function db(): Database.Database {
  const d = new Database(":memory:");
  d.exec(TENANT_SCHEMA_SQL);
  return d;
}

function configurato(d: Database.Database): void {
  const r = salvaConfigLettura(d, { baseUrl: BASE.href, chiave: LETTURA, codcli: "12345", enabled: true }, "prova");
  assert.equal(r.ok, true);
}

function hostVero(d: Database.Database): number {
  d.prepare("INSERT OR IGNORE INTO networks (id, cidr, name) VALUES (1, '192.0.2.0/24', 'prova')").run();
  return Number(
    d.prepare(
      `INSERT INTO hosts (network_id, ip, hostname, classification, os_info, open_ports, snmp_data)
       VALUES (1, '192.0.2.20', 'srv-dc01', 'server_windows', 'Windows Server 2022', '[{"port":10050}]', '')`,
    ).run().lastInsertRowid,
  );
}

const fisso = (status: number, corpo: unknown): { t: TrasportoPost; chiamate: Array<{ percorso: string; corpo: unknown }> } => {
  const chiamate: Array<{ percorso: string; corpo: unknown }> = [];
  return { chiamate, t: async (percorso, c) => { chiamate.push({ percorso, corpo: c }); return { status, body: JSON.stringify(corpo), retryAfter: null }; } };
};

test("la chiave di scrittura ha la sua forma: una chiave di lettura non entra", () => {
  const d = db();
  assert.deepEqual(salvaChiaveScrittura(d, LETTURA, "prova"), { ok: false, errore: "Chiave di scrittura non valida: deve essere nella forma zs1.…" });
  assert.equal(chiaveScrittura(d), null);
  assert.deepEqual(salvaChiaveScrittura(d, `  ${SCRITTURA} `, "prova"), { ok: true });
  assert.equal(chiaveScrittura(d), SCRITTURA);
  // Fuori esce solo la parte pubblica, e nel database il segreto non c'è in chiaro.
  assert.equal(leggiConfigScrittura(d)?.chiaveId, "0a0b0c0d");
  const grezza = d.prepare("SELECT chiave_enc FROM zabbix_scrittura_config").get() as { chiave_enc: string };
  assert.ok(!grezza.chiave_enc.includes("S".repeat(43)));
  assert.equal(togliChiaveScrittura(d), true);
  assert.equal(chiaveScrittura(d), null);
});

test("senza configurazione o senza chiave di scrittura non si chiama il centro, e si dice perché", async () => {
  const d = db();
  const id = hostVero(d);
  const { t, chiamate } = fisso(200, {});
  const dip = { db: d, acquistato: () => true, trasportoPost: () => t };
  assert.match(perchéNonSiPuò(dip) ?? "", /configurazione del centro/);
  configurato(d);
  assert.match(perchéNonSiPuò(dip) ?? "", /chiave di scrittura/);
  const r = await inserisciHost(dip, id);
  assert.deepEqual([r.ok, !r.ok && r.status], [false, 409]);
  assert.equal(chiamate.length, 0);
  assert.match(perchéNonSiPuò({ ...dip, acquistato: () => false }) ?? "", /non è compreso/);
});

test("il corpo porta l'host com'è in DA-IPAM, senza campi vuoti, e le opzioni solo se chieste", () => {
  const d = db();
  const o = oggettoDaHost(d, hostVero(d))!;
  assert.deepEqual(corpoScrittura({ ...o, altriIp: [] }), {
    ip: "192.0.2.20", hostname: "srv-dc01", classification: "server_windows",
    os_info: "Windows Server 2022", open_ports: '[{"port":10050}]',
  });
  assert.deepEqual(corpoScrittura({ ...o, altriIp: [] }, { prova: true, forza: true, serverActive: " 192.0.2.1 " }), {
    ...corpoScrittura({ ...o, altriIp: [] }), prova: true, forza: true, server_active: "192.0.2.1",
  });
  assert.equal(oggettoDaHost(d, 9999), null);
  // Gli altri IP dello stesso apparato fisico vanno al centro, mai quello dell'host stesso.
  d.prepare("INSERT INTO physical_devices (id) VALUES (20)").run();
  const id2 = Number(d.prepare("INSERT INTO hosts (network_id, ip, physical_device_id) VALUES (1, '192.0.2.122', 20)").run().lastInsertRowid);
  d.prepare("UPDATE hosts SET physical_device_id = 20 WHERE id <> ?").run(id2);
  const conAltri = oggettoDaHost(d, Number((d.prepare("SELECT id FROM hosts WHERE ip = '192.0.2.20'").get() as { id: number }).id))!;
  assert.deepEqual(conAltri.altriIp, ["192.0.2.122"]);
  assert.deepEqual(corpoScrittura(conAltri).altri_ip, ["192.0.2.122"]);
});

test("inserimento: chiave di scrittura nella richiesta, percorso giusto, esito letto", async () => {
  const d = db();
  configurato(d);
  salvaChiaveScrittura(d, SCRITTURA, "prova");
  const id = hostVero(d);
  const { t, chiamate } = fisso(200, {
    esito: "serve_agente", sistema: "windows", comando: "msiexec …", server_active: "192.0.2.1",
    nome: "srv-dc01", host: "srv-dc01", ip: "192.0.2.20", template: ["Windows by Zabbix agent active", "ICMP Ping"], motivo: "", avvisi: [],
  });
  let chiaveUsata = "";
  const r = await inserisciHost({ db: d, acquistato: () => true, trasportoPost: (_b, k) => { chiaveUsata = k; return t; } }, id);
  assert.equal(chiaveUsata, SCRITTURA, "la scrittura va con la chiave di scrittura, mai con quella di lettura");
  assert.equal(chiamate[0]?.percorso, "/wizard/api/scrittura/v1/oggetto");
  assert.ok(r.ok && r.esito.esito === "serve_agente" && r.esito.comando === "msiexec …");
});

test("errori del centro: testo nostro, e una risposta storta non passa per buona", async () => {
  const base = { base: BASE };
  await assert.rejects(
    mettiInMonitoraggio({ ...base, trasportoPost: fisso(429, { errore: "<b>server</b>", codice: "tetto_giornaliero" }).t }, { ip: "192.0.2.1" }),
    (e: unknown) => e instanceof ErroreLettura && /massimo di oggetti per oggi/.test(e.message) && !e.message.includes("<b>"),
  );
  await assert.rejects(
    mettiInMonitoraggio({ ...base, trasportoPost: fisso(503, { codice: "api_spenta" }).t }, { ip: "192.0.2.1" }),
    (e: unknown) => e instanceof ErroreLettura && /spento/.test(e.message),
  );
  await assert.rejects(
    mettiInMonitoraggio({ ...base, trasportoPost: fisso(200, { esito: "cancellato" }).t }, { ip: "192.0.2.1" }),
    (e: unknown) => e instanceof ErroreLettura && e.tipo === "risposta",
  );
  const fuori = await mettiInMonitoraggio(
    { ...base, trasportoPost: fisso(200, { esito: "fuori_perimetro", motivo: "notebook: fuori perimetro", nome: "pc", ip: "10.0.0.9", si_puo_forzare: true }).t },
    { ip: "10.0.0.9" },
  );
  assert.equal(fuori.esito, "fuori_perimetro");
});
