// T3-17 (INV-1, NUC-7 in parte): lo scheduler aspetta la fine vera della
// scansione.
//
// Prima di questa correzione `runJob` di un job di scansione tornava appena il
// giro era PARTITO: la discovery girava in background, `last_run` segnava la
// partenza, il cron poteva farne partire un altro sulla stessa rete mentre il
// primo scriveva ancora (21 accavallamenti misurati su DTS il 12/10), e un giro
// fallito non faceva fallire il job (il tracker dei fallimenti non lo vedeva).
//
// Usa il banco delle scansioni di T3-16: hub isolato importato per primo, poi
// la guardia di rete, poi i moduli dello scanner. Lanciare con
//   DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX") node --import tsx --test src/lib/cron/__tests__/scansione-attesa.test.ts
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { togliGuardiaRete } from "@/lib/scanner/__tests__/support/guardia-rete";
import fs from "node:fs";
import path from "node:path";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { resolveDataDir } from "@/lib/data-dir";
import { discoverNetwork } from "@/lib/scanner/discovery";
import * as jobs from "@/lib/cron/jobs";
import type { ScanProgress } from "@/types";
import {
  creaEsecutoreFinto,
  installaEsecutoreFinto,
  togliEsecutoreFinto,
} from "@/lib/scanner/__tests__/support/esecutore-finto";

const T = "TESTATTESASCAN";

createTenant({
  codice_cliente: T,
  ragione_sociale: "Attesa scansioni",
  indirizzo: null,
  citta: null,
  provincia: null,
  cap: null,
  telefono: null,
  email: null,
  piva: null,
  cf: null,
  referente: null,
  note: null,
  active: 1,
});

/** Mappa dei giri in corso, la stessa che legge l'interfaccia. */
function giri(): ScanProgress[] {
  const m = (globalThis as Record<string, unknown>).__daipam_scan_progress__ as Map<string, ScanProgress> | undefined;
  return m ? [...m.values()] : [];
}

/** Aspetta che nessun giro sia più in corso: una prova non lascia giri vivi alla successiva. */
async function attendiNessunGiro(): Promise<void> {
  const limite = Date.now() + 10_000;
  while (giri().some((p) => p.status === "running")) {
    if (Date.now() > limite) throw new Error("giri ancora in corso dopo 10 s");
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(async () => {
  await attendiNessunGiro();
  (globalThis as Record<string, unknown>).__daipam_scan_progress__ = new Map();
  togliEsecutoreFinto();
  deleteTenantDatabase(T);
});

after(async () => {
  await attendiNessunGiro().catch(() => undefined);
  togliEsecutoreFinto();
  togliGuardiaRete();
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

function db() {
  return getTenantDb(T);
}

function creaRete(terzoOttetto: number): number {
  return Number(
    db()
      .prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)")
      .run(`10.250.${terzoOttetto}.0/29`, `banco-${terzoOttetto}`).lastInsertRowid,
  );
}

function creaJob(tipo: string, reteId: number | null): number {
  return Number(
    db()
      .prepare("INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config) VALUES (?, ?, 60, 1, '{}')")
      .run(reteId, tipo).lastInsertRowid,
  );
}

/**
 * Avvolge le due uscite di scoperta del doppio (il fast passa da nmap -sn, il
 * ping dal ping sweep): conta i giri in volo e, se richiesto, fa fallire una rete.
 */
function avvolgiScoperta(
  executor: ReturnType<typeof creaEsecutoreFinto>["override"]["executor"],
  reteGuasta?: string,
): { massimo: () => number; chiamate: () => number } {
  let inVolo = 0;
  let massimo = 0;
  let chiamate = 0;
  const dentro = async <R>(bersaglio: string, f: () => Promise<R>): Promise<R> => {
    chiamate++;
    inVolo++;
    massimo = Math.max(massimo, inVolo);
    try {
      if (reteGuasta && bersaglio.startsWith(reteGuasta)) throw new Error("rete guasta");
      return await f();
    } finally {
      inVolo--;
    }
  };
  const sweep = executor.pingSweep.bind(executor);
  const nmap = executor.nmapDiscoverHosts.bind(executor);
  executor.pingSweep = (ips, ...resto) => dentro(ips[0] ?? "", () => sweep(ips, ...resto));
  executor.nmapDiscoverHosts = (target, ...resto) => dentro(target, () => nmap(target, ...resto));
  return { massimo: () => massimo, chiamate: () => chiamate };
}

function righeStoria(reteId: number, tipo: string): number {
  return (
    db()
      .prepare("SELECT COUNT(*) AS n FROM scan_history WHERE network_id = ? AND host_id IS NULL AND scan_type = ?")
      .get(reteId, tipo) as { n: number }
  ).n;
}

test("fast_scan: quando runJob torna il giro è finito e scritto in scan_history", async () => {
  const reteId = withTenant(T, () => creaRete(0));
  const jobId = withTenant(T, () => creaJob("fast_scan", reteId));
  const { override } = creaEsecutoreFinto({ vivi: ["10.250.0.1"], ritardoMs: 300 });
  installaEsecutoreFinto(override);

  await withTenant(T, () => jobs.runJob(jobId));

  const stati = giri().filter((p) => p.network_id === reteId).map((p) => p.status);
  assert.deepEqual(stati, ["completed"], "il giro deve essere chiuso quando il job finisce");
  assert.equal(righeStoria(reteId, "fast"), 1, "la riga del giro deve esserci già");
});

test("fast_scan: se il giro fallisce, runJob rifiuta (il tracker dei fallimenti lo vede)", async () => {
  const reteId = withTenant(T, () => creaRete(0));
  const jobId = withTenant(T, () => creaJob("fast_scan", reteId));
  const { override } = creaEsecutoreFinto({ vivi: [], lancia: new Error("esecutore guasto") });
  installaEsecutoreFinto(override);

  await assert.rejects(withTenant(T, () => jobs.runJob(jobId)), /esecutore guasto/);
  assert.equal(righeStoria(reteId, "fast"), 0);
});

test("fast_scan su tutte le reti: una rete dopo l'altra, mai due giri insieme", async () => {
  const [a, b] = withTenant(T, () => [creaRete(0), creaRete(1)]);
  const jobId = withTenant(T, () => creaJob("fast_scan", null));
  const { override } = creaEsecutoreFinto({ vivi: ["10.250.0.1", "10.250.1.1"], ritardoMs: 150 });
  const scoperta = avvolgiScoperta(override.executor);
  installaEsecutoreFinto(override);

  await withTenant(T, () => jobs.runJob(jobId));

  assert.ok(scoperta.chiamate() >= 2, `scoperte chiamate: ${scoperta.chiamate()}`);
  assert.equal(scoperta.massimo(), 1, "due giri contemporanei sullo stesso job");
  assert.equal(righeStoria(a, "fast"), 1);
  assert.equal(righeStoria(b, "fast"), 1);
});

test("fast_scan su tutte le reti: una rete che fallisce non ferma le altre, il job fallisce alla fine", async () => {
  const [a, b] = withTenant(T, () => [creaRete(0), creaRete(1)]);
  const jobId = withTenant(T, () => creaJob("fast_scan", null));
  const { override } = creaEsecutoreFinto({ vivi: ["10.250.0.1", "10.250.1.1"] });
  avvolgiScoperta(override.executor, "10.250.0.");
  installaEsecutoreFinto(override);

  await assert.rejects(withTenant(T, () => jobs.runJob(jobId)), /rete guasta/);
  assert.equal(righeStoria(a, "fast"), 0);
  assert.equal(righeStoria(b, "fast"), 1, "la seconda rete deve essere scansionata lo stesso");
});

test("un ramo che segna «failed» e ritorna senza lanciare risulta fallito", async () => {
  // scan_naabu con naabu assente: il ramo imposta failed e fa return, senza throw.
  // Il controllo di naabu prova a lanciare il binario: la guardia lo blocca, e
  // per lo scanner equivale a «naabu non disponibile».
  const reteId = withTenant(T, () => creaRete(0));
  const { override } = creaEsecutoreFinto({ vivi: ["10.250.0.1"] });
  installaEsecutoreFinto(override);

  const avvio = await withTenant(T, () => discoverNetwork(reteId, "scan_naabu"));
  const esito = await avvio.done;
  assert.equal(esito.status, "failed");
  assert.match(esito.error ?? "", /Naabu non disponibile/);
});

test("senza contesto tenant la scansione non parte (niente giro fuori da withTenant)", async () => {
  const reteId = withTenant(T, () => creaRete(0));
  const { override } = creaEsecutoreFinto({ vivi: [] });
  installaEsecutoreFinto(override);

  await assert.rejects(discoverNetwork(reteId, "ping"), /contesto tenant/i);
  assert.equal(giri().length, 0, "nessun giro deve risultare avviato");
  assert.equal(fs.existsSync(path.join(resolveDataDir(), "ipam.db")), false, "niente ripiego sul DB legacy");
});

test("«Esegui ora» di un job di scansione risponde subito con l'id del giro; last_run arriva a fine giro", async () => {
  const reteId = withTenant(T, () => creaRete(0));
  const jobId = withTenant(T, () => creaJob("fast_scan", reteId));
  const { override } = creaEsecutoreFinto({ vivi: ["10.250.0.1"], ritardoMs: 1_500 });
  installaEsecutoreFinto(override);

  const t0 = Date.now();
  const esito = await withTenant(T, () => jobs.eseguiJobOra(jobId));
  const attesa = Date.now() - t0;

  assert.equal(esito.modo, "avviato");
  assert.ok(esito.modo === "avviato" && typeof esito.scanId === "string" && esito.scanId.startsWith("scan-"));
  assert.ok(attesa < 1_000, `la risposta ha aspettato il giro (${attesa} ms)`);
  const lastRunPrima = (db().prepare("SELECT last_run FROM scheduled_jobs WHERE id = ?").get(jobId) as { last_run: string | null }).last_run;
  assert.equal(lastRunPrima, null, "last_run vuol dire fine del giro: non va scritto alla partenza");

  await attendiNessunGiro();
  // la continuazione che scrive last_run gira subito dopo la chiusura del giro
  const limite = Date.now() + 2_000;
  let lastRun: string | null = null;
  while (Date.now() < limite) {
    lastRun = (db().prepare("SELECT last_run FROM scheduled_jobs WHERE id = ?").get(jobId) as { last_run: string | null }).last_run;
    if (lastRun) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(lastRun, "a giro finito last_run deve essere scritto");
  assert.equal(righeStoria(reteId, "fast"), 1);
});

test("«Esegui ora» di un job non di scansione aspetta la fine come prima", async () => {
  const jobId = withTenant(T, () => creaJob("known_host_check", null));
  const esito = await withTenant(T, () => jobs.eseguiJobOra(jobId));
  assert.equal(esito.modo, "eseguito");
  const lastRun = (db().prepare("SELECT last_run FROM scheduled_jobs WHERE id = ?").get(jobId) as { last_run: string | null }).last_run;
  assert.ok(lastRun);
});
