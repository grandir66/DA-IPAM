// T3-18 (INV-1): sulla stessa rete dello stesso tenant non partono mai due giri,
// né dallo scheduler né a mano.
//
// Prima di questa correzione `discoverNetwork` partiva sempre: due giri sulla
// stessa rete scrivevano insieme sugli stessi host (21 accavallamenti misurati
// su DTS il 12/10), e il giro partito prima poteva spegnere host visti dal
// secondo. Le partenze arrivano da scheduler, «Esegui ora», pulsanti della pagina
// rete e aggiornamento automatico della pagina: il lucchetto sta in
// `discoverNetwork`, dove passano tutte.
//
// Usa il banco delle scansioni di T3-16. Lanciare con
//   DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX") node --import tsx --test src/lib/scanner/__tests__/network-scan-lock.test.ts
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { togliGuardiaRete } from "@/lib/scanner/__tests__/support/guardia-rete";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { discoverNetwork } from "@/lib/scanner/discovery";
import * as jobs from "@/lib/cron/jobs";
import { eseguiJobProgrammato } from "@/lib/cron/scheduler";
import * as lucchetto from "@/lib/scanner/network-scan-lock";
import type { ScanProgress } from "@/types";
import {
  creaEsecutoreFinto,
  installaEsecutoreFinto,
  togliEsecutoreFinto,
} from "@/lib/scanner/__tests__/support/esecutore-finto";

const T = "TESTLUCCHETTORETE";
const T2 = "TESTLUCCHETTORETE2";

for (const codice of [T, T2]) {
  createTenant({
    codice_cliente: codice,
    ragione_sociale: "Lucchetto rete",
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
}

function giri(): ScanProgress[] {
  const m = (globalThis as Record<string, unknown>).__daipam_scan_progress__ as Map<string, ScanProgress> | undefined;
  return m ? [...m.values()] : [];
}

async function attendiNessunGiro(): Promise<void> {
  const limite = Date.now() + 10_000;
  while (giri().some((p) => p.status === "running")) {
    if (Date.now() > limite) throw new Error("giri ancora in corso dopo 10 s");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Cancello che trattiene ping e nmap del doppio finché la prova non lo apre. */
function cancello(): { promessa: Promise<void>; apri: () => void } {
  let apri!: () => void;
  const promessa = new Promise<void>((r) => {
    apri = r;
  });
  return { promessa, apri };
}

beforeEach(async () => {
  await attendiNessunGiro();
  (globalThis as Record<string, unknown>).__daipam_scan_progress__ = new Map();
  togliEsecutoreFinto();
  deleteTenantDatabase(T);
  deleteTenantDatabase(T2);
});

after(async () => {
  await attendiNessunGiro().catch(() => undefined);
  togliEsecutoreFinto();
  togliGuardiaRete();
  deleteTenantDatabase(T);
  deleteTenantDatabase(T2);
  closeHubDb();
  removeTestHubDb();
});

function creaRete(tenant: string, terzoOttetto: number): number {
  return withTenant(tenant, () =>
    Number(
      getTenantDb(tenant)
        .prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)")
        .run(`10.251.${terzoOttetto}.0/29`, `banco-${terzoOttetto}`).lastInsertRowid,
    ),
  );
}

function creaJob(tipo: string, reteId: number | null): number {
  return Number(
    getTenantDb(T)
      .prepare("INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config) VALUES (?, ?, 60, 1, '{}')")
      .run(reteId, tipo).lastInsertRowid,
  );
}

function lastRun(jobId: number): string | null {
  return (getTenantDb(T).prepare("SELECT last_run FROM scheduled_jobs WHERE id = ?").get(jobId) as { last_run: string | null })
    .last_run;
}

// ── Discovery: il lucchetto dove passano tutte le partenze ──────────────────

test("due giri sulla stessa rete: il secondo è rifiutato con il giro in corso", async () => {
  const reteId = creaRete(T, 0);
  const c = cancello();
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: ["10.251.0.1"], cancello: c.promessa }).override);

  const primo = await withTenant(T, () => discoverNetwork(reteId, "fast"));
  try {
    await assert.rejects(
      withTenant(T, () => discoverNetwork(reteId, "nmap")),
      (e: unknown) => {
        assert.ok(lucchetto.isScanInCorso(e), `errore inatteso: ${String(e)}`);
        assert.equal(e.giro.scanId, primo.id);
        assert.equal(e.giro.scanType, "fast");
        assert.ok(!Number.isNaN(Date.parse(e.giro.startedAt)));
        return true;
      },
    );
    assert.equal(giri().filter((p) => p.network_id === reteId).length, 1, "il secondo giro non deve risultare avviato");
  } finally {
    c.apri();
    await primo.done;
  }
});

test("altra rete, o stessa rete di un altro tenant con lo stesso id: partono", async () => {
  const a = creaRete(T, 0);
  const b = creaRete(T, 1);
  const altroTenant = creaRete(T2, 0);
  assert.equal(altroTenant, a, "serve lo stesso id di rete in due tenant");
  const c = cancello();
  installaEsecutoreFinto(
    creaEsecutoreFinto({ vivi: ["10.251.0.1", "10.251.1.1"], cancello: c.promessa }).override,
  );

  const g1 = await withTenant(T, () => discoverNetwork(a, "fast"));
  const g2 = await withTenant(T, () => discoverNetwork(b, "fast"));
  const g3 = await withTenant(T2, () => discoverNetwork(altroTenant, "fast"));
  c.apri();
  const esiti = await Promise.all([g1.done, g2.done, g3.done]);
  assert.deepEqual(esiti.map((e) => e.status), ["completed", "completed", "completed"]);
});

test("a giro chiuso la rete torna libera: un terzo giro parte", async () => {
  const reteId = creaRete(T, 0);
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: ["10.251.0.1"], ritardoMs: 50 }).override);

  const primo = await withTenant(T, () => discoverNetwork(reteId, "fast"));
  assert.equal((await primo.done).status, "completed");
  assert.equal(lucchetto.giroSullaRete(T, reteId), undefined, "la rete deve essere libera quando done si chiude");
  const terzo = await withTenant(T, () => discoverNetwork(reteId, "fast"));
  assert.equal((await terzo.done).status, "completed");
});

test("se il giro fallisce la rete torna libera", async () => {
  const reteId = creaRete(T, 0);
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: [], lancia: new Error("esecutore guasto") }).override);

  const primo = await withTenant(T, () => discoverNetwork(reteId, "fast"));
  assert.equal((await primo.done).status, "failed");
  assert.equal(lucchetto.giroSullaRete(T, reteId), undefined);

  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: ["10.251.0.1"] }).override);
  const dopo = await withTenant(T, () => discoverNetwork(reteId, "fast"));
  assert.equal((await dopo.done).status, "completed");
});

test("una partenza rifiutata per altri motivi non lascia la rete occupata", async () => {
  const reteId = creaRete(T, 0);
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: [] }).override);
  await assert.rejects(
    withTenant(T, () => discoverNetwork(reteId, "nmap", undefined, null, { targetIps: ["192.0.2.1"] })),
    /Nessun host selezionato/,
  );
  assert.equal(lucchetto.giroSullaRete(T, reteId), undefined);
});

// ── Lo scheduler e «Esegui ora» ──────────────────────────────────────────────

test("runJob su rete occupata: «saltato» col giro in corso, e lo scheduler non scrive last_run", async () => {
  const reteId = creaRete(T, 0);
  const jobId = withTenant(T, () => creaJob("fast_scan", reteId));
  const c = cancello();
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: ["10.251.0.1"], cancello: c.promessa }).override);

  const primo = await withTenant(T, () => discoverNetwork(reteId, "network_discovery"));
  try {
    const esito = await withTenant(T, () => jobs.runJob(jobId));
    assert.equal(esito.esito, "saltato");
    assert.ok(esito.esito === "saltato" && esito.giroInCorso?.scanId === primo.id);

    const programmato = await eseguiJobProgrammato(`${T}:${jobId}`, jobId, T);
    assert.equal(programmato, "saltato");
    assert.equal(lastRun(jobId), null, "un giro saltato non aggiorna last_run");
  } finally {
    c.apri();
    await primo.done;
  }

  // a rete libera lo stesso job gira e scrive last_run
  assert.equal(await eseguiJobProgrammato(`${T}:${jobId}`, jobId, T), "eseguito");
  assert.ok(lastRun(jobId));
});

test("«Esegui ora» su rete occupata: risponde «saltato» col giro in corso, senza last_run", async () => {
  const reteId = creaRete(T, 0);
  const jobId = withTenant(T, () => creaJob("fast_scan", reteId));
  const c = cancello();
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: ["10.251.0.1"], cancello: c.promessa }).override);

  const primo = await withTenant(T, () => discoverNetwork(reteId, "fast"));
  try {
    const esito = await withTenant(T, () => jobs.eseguiJobOra(jobId));
    assert.equal(esito.modo, "saltato");
    assert.ok(esito.modo === "saltato" && esito.giroInCorso?.scanId === primo.id);
    assert.equal(lastRun(jobId), null);
  } finally {
    c.apri();
    await primo.done;
  }
});

test("job su tutte le reti: la rete occupata si salta, le altre girano; tutte occupate = saltato", async () => {
  const a = creaRete(T, 0);
  const b = creaRete(T, 1);
  const jobId = withTenant(T, () => creaJob("fast_scan", null));
  const c = cancello();
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: ["10.251.0.1", "10.251.1.1"], cancello: c.promessa }).override);

  const suA = await withTenant(T, () => discoverNetwork(a, "fast"));
  const job = withTenant(T, () => jobs.runJob(jobId));
  // il giro su B parte e resta trattenuto dal cancello: si apre per entrambi
  await new Promise((r) => setTimeout(r, 50));
  c.apri();
  const esito = await job;
  await suA.done;
  assert.equal(esito.esito, "eseguito");
  assert.match(esito.motivo ?? "", /1 ret[ei] su 2 saltat/);

  // tutte occupate
  const c2 = cancello();
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: [], cancello: c2.promessa }).override);
  const ga = await withTenant(T, () => discoverNetwork(a, "fast"));
  const gb = await withTenant(T, () => discoverNetwork(b, "fast"));
  try {
    const tutte = await withTenant(T, () => jobs.runJob(jobId));
    assert.equal(tutte.esito, "saltato");
  } finally {
    c2.apri();
    await Promise.all([ga.done, gb.done]);
  }
});

// ── Il modulo da solo: rilascio, due copie, allarme di durata, 409 ───────────

test("il rilascio è idempotente e non libera la rete presa da un giro successivo", () => {
  const rilascia1 = lucchetto.prendiRete("TPURO", 1, { scanId: "s1", scanType: "fast" }, { ora: 0 });
  rilascia1();
  const rilascia2 = lucchetto.prendiRete("TPURO", 1, { scanId: "s2", scanType: "fast" }, { ora: 1 });
  rilascia1();
  assert.equal(lucchetto.giroSullaRete("TPURO", 1)?.scanId, "s2", "il vecchio rilascio non deve liberare il nuovo giro");
  rilascia2();
  assert.equal(lucchetto.giroSullaRete("TPURO", 1), undefined);
});

test("due copie del modulo vedono lo stesso lucchetto", () => {
  const percorso = require.resolve("../network-scan-lock");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const a = require(percorso) as typeof import("../network-scan-lock");
  delete require.cache[percorso];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const b = require(percorso) as typeof import("../network-scan-lock");
  assert.notEqual(a, b, "servono due istanze distinte del modulo per la prova");

  const rilascia = a.prendiRete("TDOPPIO", 7, { scanId: "s1", scanType: "fast" });
  try {
    assert.throws(
      () => b.prendiRete("TDOPPIO", 7, { scanId: "s2", scanType: "nmap" }),
      (e: unknown) => a.isScanInCorso(e) && b.isScanInCorso(e),
    );
  } finally {
    rilascia();
  }
  assert.equal(b.giroSullaRete("TDOPPIO", 7), undefined, "il rilascio della prima copia libera anche la seconda");
});

test("un giro oltre la soglia scrive una sola riga d'allarme e la rete resta occupata", () => {
  const righe: string[] = [];
  const originale = console.error;
  console.error = (...args: unknown[]) => {
    righe.push(args.map(String).join(" "));
  };
  const min = 60_000;
  const rilascia = lucchetto.prendiRete("TALLARME", 3, { scanId: "lungo", scanType: "nmap" }, { ora: 0 });
  try {
    const prova = (ora: number) =>
      assert.throws(
        () => lucchetto.prendiRete("TALLARME", 3, { scanId: "x", scanType: "fast" }, { ora, sogliaAllarmeMinuti: 100 }),
        (e: unknown) => lucchetto.isScanInCorso(e),
      );
    prova(99 * min);
    assert.equal(righe.length, 0, "sotto soglia nessun allarme");
    prova(101 * min);
    prova(150 * min);
    prova(400 * min);
    assert.equal(righe.length, 1, `una sola riga d'allarme, scritte: ${righe.length}`);
    assert.match(righe[0], /ALLARME/);
    assert.equal(lucchetto.giroSullaRete("TALLARME", 3)?.scanId, "lungo", "l'allarme non libera la rete");
  } finally {
    console.error = originale;
    rilascia();
  }
});

test("la soglia dell'allarme si legge da tenant_settings; valori non validi → 100 minuti", async () => {
  assert.equal(lucchetto.sogliaAllarmeDa(null), 100);
  assert.equal(lucchetto.sogliaAllarmeDa("abc"), 100);
  assert.equal(lucchetto.sogliaAllarmeDa("0"), 100);
  assert.equal(lucchetto.sogliaAllarmeDa("30"), 30);

  // nella discovery: soglia del tenant a 1 minuto, giro in corso «da 2 minuti»
  const reteId = creaRete(T, 0);
  withTenant(T, () => setTenantSetting(lucchetto.CHIAVE_SOGLIA_ALLARME, "1"));
  const c = cancello();
  installaEsecutoreFinto(creaEsecutoreFinto({ vivi: [], cancello: c.promessa }).override);
  const primo = await withTenant(T, () => discoverNetwork(reteId, "fast"));
  const righe: string[] = [];
  const originale = console.error;
  const oraVera = Date.now;
  console.error = (...args: unknown[]) => {
    righe.push(args.map(String).join(" "));
  };
  Date.now = () => oraVera() + 2 * 60_000;
  try {
    await assert.rejects(withTenant(T, () => discoverNetwork(reteId, "fast")), (e: unknown) => lucchetto.isScanInCorso(e));
  } finally {
    Date.now = oraVera;
    console.error = originale;
    c.apri();
    await primo.done;
  }
  assert.equal(righe.filter((r) => r.includes("ALLARME")).length, 1);
});

test("corpo del 409: messaggio pronto per l'interfaccia, in ora italiana, e campi del giro", () => {
  const corpo = lucchetto.corpoScanInCorso({ scanId: "scan-1", scanType: "fast", startedAt: "2026-10-13T08:42:00.000Z" });
  assert.equal(corpo.codice, "scan_in_corso");
  assert.equal(
    corpo.error,
    "Scansione non avviata: su questa rete è già in corso «Scansione veloce», partita alle 10:42. Riprova quando è finita.",
  );
  assert.deepEqual(corpo.scan_in_corso, { id: "scan-1", scan_type: "fast", started_at: "2026-10-13T08:42:00.000Z" });
});
