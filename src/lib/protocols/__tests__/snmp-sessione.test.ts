/**
 * Versione SNMP sempre esplicita (2026-10-15).
 *
 * INCIDENTE (DTS, 15/10): in net-snmp `createSession` SENZA `version` parla v1
 * e `version: 1` vuol dire v2c. La discovery forzava v2c, mentre lettura dati,
 * client switch/router, sonda interfacce e test credenziali parlavano v1 per
 * caso. Gli AP Ubiquiti 172.16.3.4-7 rispondono SOLO in v1: chi avesse
 * «sistemato» un createSession mettendo v2c li avrebbe spenti senza saperlo.
 * Da qui un solo punto che apre le sessioni a community, con la versione
 * dichiarata da chi chiama, e questa prova che non ne nascano altri.
 *
 * INCIDENTE (tappa 2 credenziali, T4, 15/10): cinque punti aprivano da soli la
 * sessione v3, tutti con authNoPriv e MD5 fissi. Anche `createV3Session(` sta
 * solo qui, dentro `apriSessioneSnmp`, con le opzioni prese dal record.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as snmp from "net-snmp";
import {
  apriSessioneCommunity,
  provaVersioniSnmp,
  versioneApparato,
  versioneNetSnmp,
} from "@/lib/protocols/snmp-sessione";
import { avviaAgenteFinto, type AgenteFinto } from "./support/agente-snmp-finto";

const SYSDESCR = "1.3.6.1.2.1.1.1.0";
const aperti: AgenteFinto[] = [];
after(async () => {
  for (const a of aperti) await a.chiudi();
});
async function agente(versioni: Array<"1" | "2c">): Promise<AgenteFinto> {
  const a = await avviaAgenteFinto({ versioni, valori: { [SYSDESCR]: "Linux finto armv5" } });
  aperti.push(a);
  return a;
}

test("apriSessioneCommunity passa sempre la versione, anche la v1", () => {
  const viste: Array<Record<string, unknown>> = [];
  const finto = {
    Version1: snmp.Version1,
    Version2c: snmp.Version2c,
    createSession: (_h: string, _c: string, o?: Record<string, unknown>) => {
      viste.push(o ?? {});
      return {} as ReturnType<typeof snmp.createSession>;
    },
  } as unknown as typeof snmp;
  apriSessioneCommunity(finto, "192.0.2.1", "x", { port: 161, timeout: 5000, versione: "1" });
  apriSessioneCommunity(finto, "192.0.2.1", "x", { port: 1161, timeout: 900, versione: "2c" });
  assert.deepEqual(viste, [
    { port: 161, timeout: 5000, version: snmp.Version1 },
    { port: 1161, timeout: 900, version: snmp.Version2c },
  ]);
  assert.equal(versioneNetSnmp(snmp, "1"), 0, "Version1 di net-snmp");
  assert.equal(versioneNetSnmp(snmp, "2c"), 1, "Version2c di net-snmp");
});

test("versioneApparato: NULL dà la versione di prima del punto che chiama, il resto passa com'è", () => {
  assert.equal(versioneApparato({ snmp_version: null }, "1"), "1");
  assert.equal(versioneApparato({ snmp_version: null }, "2c"), "2c");
  assert.equal(versioneApparato({}, "1"), "1");
  assert.equal(versioneApparato(undefined, "2c"), "2c");
  assert.equal(versioneApparato({ snmp_version: "1" }, "2c"), "1");
  assert.equal(versioneApparato({ snmp_version: "2c" }, "1"), "2c");
  assert.equal(versioneApparato({ snmp_version: "3" }, "1"), "1", "un valore sconosciuto non cambia niente");
});

test("la sessione aperta parla davvero la versione chiesta (net-snmp vero, agente locale)", async () => {
  const a = await agente(["1", "2c"]);
  for (const versione of ["1", "2c"] as const) {
    const s = apriSessioneCommunity(snmp, "127.0.0.1", "public", { port: a.porta, timeout: 800, retries: 0, versione });
    await new Promise<void>((resolve) => s.get([SYSDESCR], () => { s.close(); resolve(); }));
  }
  assert.deepEqual(a.versioniViste(), ["1", "2c"]);
});

test("provaVersioniSnmp su un agente solo v1: prova v2c, poi v1, e dice v1", async () => {
  const a = await agente(["1"]);
  const esito = await provaVersioniSnmp(snmp, "127.0.0.1", "public", { port: a.porta, timeoutMs: 400, oids: [SYSDESCR] });
  assert.equal(esito.ok, true);
  assert.equal(esito.ok && esito.versione, "1");
  assert.deepEqual(a.versioniViste(), ["2c", "1"]);
});

test("provaVersioniSnmp su un agente v2c: una richiesta sola", async () => {
  const a = await agente(["2c"]);
  const esito = await provaVersioniSnmp(snmp, "127.0.0.1", "public", { port: a.porta, timeoutMs: 400, oids: [SYSDESCR] });
  assert.equal(esito.ok && esito.versione, "2c");
  assert.deepEqual(a.versioniViste(), ["2c"]);
});

test("provaVersioniSnmp su un agente muto: errore con tutte e due le versioni, mai un ok", async () => {
  const a = await agente([]);
  const esito = await provaVersioniSnmp(snmp, "127.0.0.1", "public", { port: a.porta, timeoutMs: 300, oids: [SYSDESCR] });
  assert.equal(esito.ok, false);
  assert.match(!esito.ok ? esito.errore : "", /v2c: .*; v1: /);
});

/** File che contengono la chiamata `cerca` fuori da snmp-sessione.ts. */
function chiamateFuoriDalHelper(radice: string, cerca: RegExp): string[] {
  const trovati: string[] = [];
  const visita = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        visita(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts") && e.name !== "snmp-sessione.ts") {
        const righe = fs.readFileSync(p, "utf8").split("\n");
        righe.forEach((r, i) => {
          if (cerca.test(r)) trovati.push(`${path.relative(radice, p)}:${i + 1}`);
        });
      }
    }
  };
  visita(radice);
  return trovati;
}

test("INVARIANTE: nessun createSession( a community fuori da snmp-sessione.ts", () => {
  const src = path.resolve(__dirname, "../../..");
  assert.ok(fs.existsSync(path.join(src, "lib/protocols/snmp-sessione.ts")), `radice sbagliata: ${src}`);
  assert.deepEqual(
    chiamateFuoriDalHelper(src, /\.createSession\s*\(/),
    [],
    "aprire la sessione con apriSessioneCommunity(snmp, host, community, { …, versione }) e scegliere la versione con versioneApparato(device, <quella di prima>)"
  );
});

test("INVARIANTE: nessun createV3Session( fuori da snmp-sessione.ts", () => {
  const src = path.resolve(__dirname, "../../..");
  assert.ok(fs.existsSync(path.join(src, "lib/protocols/snmp-sessione.ts")), `radice sbagliata: ${src}`);
  assert.deepEqual(
    chiamateFuoriDalHelper(src, /createV3Session\s*\(/),
    [],
    "aprire la sessione v3 con apriSessioneSnmp(snmp, host, { forma: \"v3\", record }, { port, timeout, versione: null }): livello, protocolli e chiavi vengono dal record"
  );
});
