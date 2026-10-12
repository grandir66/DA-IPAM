/**
 * Lettura dei profili assessment da un edge (EDG-1), contro un finto edge HTTP
 * locale che risponde come quello vero: il client manda il token sul percorso
 * giusto, legge la risposta vera, e ogni guasto (404, 500, testo, forma
 * sbagliata) diventa un errore leggibile, mai una lista vuota. Poi il controllo
 * che le rotte fanno prima di avviare o pianificare una scansione: un profilo
 * che l'edge non ha si ferma in DA-IPAM con un errore, invece di fallire in
 * silenzio sull'edge dopo la scansione.
 *
 * Gira su un tenant temporaneo:
 *   DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/vuln/__tests__/edge-profiles-client.test.ts
 */
process.env.ENCRYPTION_KEY ||= "test-encryption-key-edge-profiles";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { encrypt } from "@/lib/crypto";
import { EdgeClientError, listEdgeProfiles } from "@/lib/vuln/scanner-edge-client";
import {
  resolveAssessmentForNetwork,
  saveEdgeSubnetSchedule,
  triggerSubnetEdgeScan,
} from "@/lib/vuln/edge-subnet-bridge";

const T = "TESTEDGEPROFILES";
const TOKEN = "tok-edge-di-prova";

/** Stessa risposta vera di edge-profiles.test.ts (list_profiles() di scanner_edge, 2026-10-12). */
const RISPOSTA_VERA =
  '{"profiles":[{"id":"safe-esterno","label":"Safe esterno","image":"advanced","requires_authorization":false,"steps":["amass","dns-enum","tls-deep"]},{"id":"smoke-interno","label":"Smoke interno","image":"advanced","requires_authorization":false,"steps":["service-fp"]},{"id":"validation-plus","label":"Validation plus","image":"advanced","requires_authorization":true,"steps":["enum4linux-ng","ldap-enum","cred-bind","tls-deep","cis-check","service-fp","snmp-enum"]}]}';

type Reply = { status: number; body: string; type?: string };

let server: Server;
let baseUrl = "";
let reply: Reply = { status: 200, body: RISPOSTA_VERA };
/** Risposte per "METODO /percorso" (senza query): se c'è, vince su `reply`. */
let routes: Record<string, Reply> = {};
const seen: Array<{ method: string; url: string; auth: string | undefined; body: string }> = [];

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body });
      const path = (req.url ?? "").split("?")[0];
      const r = routes[`${req.method} ${path}`] ?? reply;
      res.writeHead(r.status, { "Content-Type": r.type ?? "application/json" });
      res.end(r.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  deleteTenantDatabase(T);
});

function scanner() {
  return { base_url: baseUrl, token_encrypted: encrypt(TOKEN), cert_pin: null };
}

async function edgeError(p: Promise<unknown>): Promise<EdgeClientError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof EdgeClientError, `atteso EdgeClientError, ricevuto ${String(e)}`);
    return e;
  }
  assert.fail("doveva fallire");
}

test("listEdgeProfiles: GET /api/v1/profiles col token, e la risposta vera diventa l'elenco", async () => {
  reply = { status: 200, body: RISPOSTA_VERA };
  const list = await listEdgeProfiles(scanner());
  assert.deepEqual(
    list.profiles.map((p) => [p.id, p.label]),
    [
      ["safe-esterno", "Safe esterno"],
      ["smoke-interno", "Smoke interno"],
      ["validation-plus", "Validation plus"],
    ],
  );
  assert.equal(list.ignored, 0);
  const last = seen.at(-1)!;
  assert.equal(last.method, "GET");
  assert.equal(last.url, "/api/v1/profiles");
  assert.equal(last.auth, `Bearer ${TOKEN}`);
});

test("listEdgeProfiles: il filtro image va nella query", async () => {
  reply = { status: 200, body: '{"profiles":[]}' };
  const list = await listEdgeProfiles(scanner(), { image: "advanced" });
  assert.deepEqual(list.profiles, []);
  assert.equal(seen.at(-1)!.url, "/api/v1/profiles?image=advanced");
});

test("listEdgeProfiles: un errore FastAPI ({detail}) arriva come testo leggibile, non come JSON", async () => {
  reply = { status: 404, body: '{"detail":"Not Found"}' };
  const e = await edgeError(listEdgeProfiles(scanner()));
  assert.equal(e.status, 404);
  assert.equal(e.message, "edge 404: Not Found");
});

test("listEdgeProfiles: 500 in testo semplice → errore con lo stato", async () => {
  reply = { status: 500, body: "Internal Server Error", type: "text/plain" };
  const e = await edgeError(listEdgeProfiles(scanner()));
  assert.equal(e.status, 500);
  assert.match(e.message, /edge 500: Internal Server Error/);
});

test("listEdgeProfiles: 200 con la forma sbagliata → errore, non una lista vuota", async () => {
  reply = { status: 200, body: '{"items":[]}' };
  const e = await edgeError(listEdgeProfiles(scanner()));
  assert.match(e.message, /profili/i);
});

test("listEdgeProfiles: 200 che non è JSON → errore", async () => {
  reply = { status: 200, body: "<html>login</html>", type: "text/html" };
  const e = await edgeError(listEdgeProfiles(scanner()));
  assert.match(e.message, /non-JSON/);
});

test("resolveAssessmentForNetwork: il profilo si controlla sull'edge prima di scrivere", async () => {
  await withTenant(T, async () => {
    const db = getTenantDb(T);
    const net = Number(
      db.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'prova')").run().lastInsertRowid,
    );
    db.prepare(
      "INSERT INTO vuln_scanners (name, base_url, token_encrypted, enabled) VALUES ('edge di prova', ?, ?, 1)",
    ).run(baseUrl, encrypt(TOKEN));

    // Profilo che l'edge ha: si va avanti.
    reply = { status: 200, body: RISPOSTA_VERA };
    assert.deepEqual(await resolveAssessmentForNetwork(net, { enabled: true, profileId: "validation-plus" }), {
      ok: true,
      enabled: true,
      profileId: "validation-plus",
    });

    // Profilo della vecchia lista fissa, che l'edge non ha mai avuto: errore visibile.
    const assente = await resolveAssessmentForNetwork(net, { enabled: true, profileId: "interno-approfondito" });
    assert.equal(assente.ok, false);
    if (!assente.ok) {
      assert.equal(assente.status, 422);
      assert.match(assente.error, /«interno-approfondito»/);
      assert.match(assente.error, /validation-plus/);
    }

    // Assessment spento: nessuna chiamata all'edge.
    const prima = seen.length;
    assert.deepEqual(await resolveAssessmentForNetwork(net, { enabled: false }), {
      ok: true,
      enabled: false,
      profileId: null,
    });
    assert.equal(seen.length, prima);

    // Acceso senza profilo: errore, nessun profilo inventato.
    const senza = await resolveAssessmentForNetwork(net, { enabled: true, profileId: null });
    assert.equal(senza.ok, false);
    if (!senza.ok) assert.equal(senza.status, 400);

    // Schedulazione salvata con un profilo che l'edge non ha più: la richiesta che
    // non tocca l'assessment la ripropone, e l'errore si vede.
    db.prepare("UPDATE networks SET assessment_enabled = 1, assessment_profile_id = 'safe-interno' WHERE id = ?").run(net);
    const salvato = await resolveAssessmentForNetwork(net, {});
    assert.equal(salvato.ok, false);
    if (!salvato.ok) {
      assert.equal(salvato.status, 422);
      assert.match(salvato.error, /«safe-interno»/);
    }

    // L'edge non risponde come deve: errore, non via libera.
    reply = { status: 500, body: "Internal Server Error", type: "text/plain" };
    const guasto = await resolveAssessmentForNetwork(net, { enabled: true, profileId: "validation-plus" });
    assert.equal(guasto.ok, false);
    if (!guasto.ok) {
      assert.equal(guasto.status, 502);
      assert.match(guasto.error, /edge 500/);
    }

    // Rete inesistente.
    const nessuna = await resolveAssessmentForNetwork(9999, { enabled: true, profileId: "validation-plus" });
    assert.equal(nessuna.ok, false);
    if (!nessuna.ok) assert.equal(nessuna.status, 404);

    // Scanner disattivato: lo dice, non tenta.
    db.prepare("UPDATE vuln_scanners SET enabled = 0").run();
    const spento = await resolveAssessmentForNetwork(net, { enabled: true, profileId: "validation-plus" });
    assert.equal(spento.ok, false);
    if (!spento.ok) assert.equal(spento.status, 409);
  });
});

test("pianificazione e avvio: il profilo nuovo si scrive nel DB solo dopo che l'edge l'ha accettato con /networks/ensure", async () => {
  await withTenant(T, async () => {
    const db = getTenantDb(T);
    db.prepare("UPDATE vuln_scanners SET enabled = 1").run();
    // Rete con un profilo che l'edge non ha più: la pagina mostra «Profilo assente»
    // finché il DB dice così. Il badge si calcola sul DB: il DB deve dire cosa ha l'edge.
    const net = Number(
      db
        .prepare(
          "INSERT INTO networks (cidr, name, assessment_enabled, assessment_profile_id) VALUES ('10.9.1.0/24', 'prova ensure', 1, 'safe-interno')",
        )
        .run().lastInsertRowid,
    );
    const letto = () =>
      db.prepare("SELECT assessment_enabled, assessment_profile_id FROM networks WHERE id = ?").get(net) as {
        assessment_enabled: number;
        assessment_profile_id: string | null;
      };
    const pianificazione = {
      enabled: true,
      profile: "balanced" as const,
      cronExpr: "0 3 1 * *",
      jobName: "prova ensure",
      frequency: "monthly" as const,
      atTime: "03:00",
      dayOfMonth: 1,
      assessmentEnabled: true,
      assessmentProfileId: "smoke-interno",
    };
    reply = { status: 200, body: RISPOSTA_VERA };

    try {
      // L'edge rifiuta /ensure (toggle IPAM spento): il DB resta com'era, il badge resta.
      routes = { "POST /api/v1/networks/ensure": { status: 404, body: '{"detail":"ipam integration disabled"}' } };
      const pianificaKo = await saveEdgeSubnetSchedule(net, pianificazione);
      assert.equal(pianificaKo.ok, false);
      assert.match(pianificaKo.error ?? "", /ipam integration disabled/);
      assert.deepEqual({ ...letto() }, { assessment_enabled: 1, assessment_profile_id: "safe-interno" });

      const avviaKo = await triggerSubnetEdgeScan(net, { assessmentEnabled: true, assessmentProfileId: "smoke-interno" });
      assert.equal(avviaKo.ok, false);
      assert.deepEqual({ ...letto() }, { assessment_enabled: 1, assessment_profile_id: "safe-interno" });

      // /ensure accettato: il profilo nuovo va all'edge nel corpo, poi nel DB.
      routes = {
        "POST /api/v1/networks/ensure": { status: 200, body: '{"ok":true,"network_id":7,"host_count":0}' },
        "PUT /api/v1/networks/7/schedule": { status: 200, body: '{"ok":true}' },
      };
      const pianificaOk = await saveEdgeSubnetSchedule(net, pianificazione);
      assert.equal(pianificaOk.ok, true, pianificaOk.error);
      const ensure = seen.filter((s) => s.url === "/api/v1/networks/ensure").at(-1)!;
      const inviato = JSON.parse(ensure.body) as { assessment_enabled: boolean; assessment_profile_id: string | null };
      assert.equal(inviato.assessment_enabled, true);
      assert.equal(inviato.assessment_profile_id, "smoke-interno");
      assert.deepEqual({ ...letto() }, { assessment_enabled: 1, assessment_profile_id: "smoke-interno" });

      // Avvio: /ensure accettato e scansione rifiutata. L'edge ha già il profilo
      // nuovo, quindi il DB lo segue.
      routes = {
        "POST /api/v1/networks/ensure": { status: 200, body: '{"ok":true,"network_id":7,"host_count":0}' },
        "POST /api/v1/networks/7/scan": { status: 500, body: "Internal Server Error", type: "text/plain" },
      };
      const avviaScanKo = await triggerSubnetEdgeScan(net, {
        assessmentEnabled: true,
        assessmentProfileId: "validation-plus",
      });
      assert.equal(avviaScanKo.ok, false);
      assert.deepEqual({ ...letto() }, { assessment_enabled: 1, assessment_profile_id: "validation-plus" });
    } finally {
      routes = {};
    }
  });
});

test("lucchetto: la rotta edge-scan non scrive l'assessment da sé (lo scrive il bridge dopo /networks/ensure)", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/networks/[id]/edge-scan/route.ts"), "utf8");
  assert.doesNotMatch(src, /setNetworkAssessmentConfig\s*\(/);
});
