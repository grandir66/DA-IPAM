/**
 * `credential_validate` prova anche le voci `snmp_v3` (tappa 2 credenziali,
 * T12, 16/10).
 *
 * Perché: il ramo SNMP della validazione partiva solo con
 * `credType === "snmp"`, e dentro decideva v3 o community. Dalla 2c una
 * SNMP v3 è di tipo `snmp_v3`: senza la regola unica non veniva mai provata.
 *
 * La prova avvia il giro vero su 127.0.0.1 con la voce v3 sulla porta di un
 * socket UDP muto: vale se al socket arriva la richiesta SNMP e il giro
 * scrive l'esito del ramo v3.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/scanner/__tests__/validazione-snmp-v3.test.ts
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0".repeat(64);

import { it, before, after } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import { encrypt } from "@/lib/crypto";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { discoverNetwork } from "../discovery";

const T = "TESTVALIDAV3";
const NET = 1;
const HOST = 1;
const V3 = 701;

let muto: dgram.Socket;
let porta = 0;
let ricevuti = 0;

before(async () => {
  muto = dgram.createSocket("udp4");
  muto.on("message", () => { ricevuti += 1; });
  await new Promise<void>((ok) => muto.bind(0, "127.0.0.1", () => ok()));
  porta = muto.address().port;
  withTenant(T, () => {
    const d = getTenantDb(T);
    d.prepare(`INSERT INTO networks (id, cidr, name) VALUES (?, '127.0.0.0/30', 'loopback')`).run(NET);
    d.prepare(`INSERT INTO hosts (id, network_id, ip, open_ports) VALUES (?, ?, '127.0.0.1', ?)`)
      .run(HOST, NET, JSON.stringify([{ port: 161, service: "snmp" }]));
    d.prepare(
      `INSERT INTO credentials (id, name, credential_type, port, encrypted_username, security_level, auth_protocol, encrypted_auth_key)
       VALUES (?, 'v3 prova', 'snmp_v3', ?, ?, 'authNoPriv', 'SHA', ?)`
    ).run(V3, porta, encrypt("monitor"), encrypt("chiave-auth-123"));
    d.prepare(`INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, 0)`).run(NET, V3);
  });
});

after(() => {
  muto.close();
  deleteTenantDatabase(T);
});

it("una voce snmp_v3 della rete si prova col ramo v3", { timeout: 60_000 }, async () => {
  const avvio = await withTenant(T, () => discoverNetwork(NET, "credential_validate", undefined, null, { targetIps: ["127.0.0.1"] }));
  const esito = await avvio.done;
  assert.equal(esito.status, "completed", JSON.stringify(esito));
  const log = (avvio.progress.logs ?? []).join("\n");
  assert.ok(ricevuti > 0, `nessuna richiesta SNMP arrivata alla porta della voce v3. Log:\n${log}`);
  assert.match(log, new RegExp(`SNMPv3 cred#${V3}`), "il giro non ha scritto l'esito del ramo v3");
});
