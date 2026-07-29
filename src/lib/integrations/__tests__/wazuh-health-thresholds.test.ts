import { describe, it } from "node:test";
import assert from "node:assert";
import {
  classifyDiskUsage, classifyManager, classifyIndexer, classifyIngestion, classifyReplication,
} from "../wazuh-health-thresholds";

const ORA = Date.parse("2026-07-29T12:00:00Z");

describe("disco", () => {
  it("sotto l'85% è ok", () => assert.equal(classifyDiskUsage(84), "ok"));
  it("all'85% è degradato", () => assert.equal(classifyDiskUsage(85), "degraded"));
  it("al 95% è errore", () => assert.equal(classifyDiskUsage(95), "fail"));
  it("valore assente è ok", () => assert.equal(classifyDiskUsage(null), "ok"));
});

describe("manager", () => {
  it("tutti i demoni attivi", () => {
    const b = classifyManager([{ name: "wazuh-analysisd", status: "running" },
                               { name: "wazuh-modulesd", status: "running" }]);
    assert.equal(b.verdict, "ok");
  });
  it("un demone fermo è errore e viene nominato", () => {
    const b = classifyManager([{ name: "wazuh-analysisd", status: "stopped" },
                               { name: "wazuh-modulesd", status: "running" }]);
    assert.equal(b.verdict, "fail");
    assert.ok(b.headline.includes("wazuh-analysisd"));
  });

  // Bug di campo (appliance 192.168.4.8 vs Wazuh 192.168.4.19): questi sette
  // demoni sono OPZIONALI e disabilitati per default in un'installazione
  // Wazuh sana (agentless, syslog, output DB, integrazioni esterne, email,
  // report, solo-cluster). Prima del fix producevano un falso "fail" su
  // praticamente ogni appliance sul campo.
  const DEMONI_OPZIONALI_FERMI = [
    "wazuh-agentlessd", "wazuh-csyslogd", "wazuh-dbd", "wazuh-integratord",
    "wazuh-maild", "wazuh-reportd", "wazuh-clusterd",
  ].map((name) => ({ name, status: "stopped" }));

  const ESSENZIALI_ATTIVI = [
    "wazuh-analysisd", "wazuh-remoted", "wazuh-monitord", "wazuh-execd",
    "wazuh-modulesd", "wazuh-syscheckd", "wazuh-logcollector", "wazuh-db", "wazuh-apid",
  ].map((name) => ({ name, status: "running" }));

  it("demoni opzionali fermi con tutti gli essenziali attivi non produce fail (caso reale sul campo)", () => {
    const b = classifyManager([...ESSENZIALI_ATTIVI, ...DEMONI_OPZIONALI_FERMI]);
    assert.equal(b.verdict, "ok");
    assert.ok(b.detail?.some((d) => d.includes("opzionali")));
  });

  it("un demone essenziale fermo resta fail con il suo nome in headline, anche con opzionali fermi", () => {
    const essenzialiConAnalysisdFermo = ESSENZIALI_ATTIVI.map((d) =>
      d.name === "wazuh-analysisd" ? { name: d.name, status: "stopped" } : d);
    const b = classifyManager([...essenzialiConAnalysisdFermo, ...DEMONI_OPZIONALI_FERMI]);
    assert.equal(b.verdict, "fail");
    assert.ok(b.headline.includes("wazuh-analysisd"));
  });

  it("elenco vuoto è gestito senza lanciare", () => {
    assert.doesNotThrow(() => classifyManager([]));
    assert.equal(classifyManager([]).verdict, "ok");
  });
});

describe("indexer", () => {
  it("cluster verde e disco basso", () => {
    const b = classifyIndexer({ status: "green" }, [{ node: "n1", diskPercent: 60 }]);
    assert.equal(b.verdict, "ok");
  });
  it("cluster giallo è degradato", () => {
    assert.equal(classifyIndexer({ status: "yellow" }, []).verdict, "degraded");
  });
  it("cluster rosso è errore", () => {
    assert.equal(classifyIndexer({ status: "red" }, []).verdict, "fail");
  });
  it("un nodo oltre il 95% è errore anche con cluster verde", () => {
    const b = classifyIndexer({ status: "green" }, [{ node: "n1", diskPercent: 96 }]);
    assert.equal(b.verdict, "fail");
  });
  it("la headline mostra il nodo peggiore, non la media", () => {
    const b = classifyIndexer({ status: "green" }, [
      { node: "n1", diskPercent: 10 },
      { node: "n2", diskPercent: 10 },
      { node: "n3", diskPercent: 96 },
    ]);
    assert.equal(b.verdict, "fail");
    assert.ok(b.headline.includes("96"));
    assert.ok(b.headline.includes("n3"));
  });
});

describe("ingestione", () => {
  it("alert recente è ok", () => {
    const b = classifyIngestion({ newestAlertIso: "2026-07-29T11:50:00Z", nowMs: ORA });
    assert.equal(b.verdict, "ok");
  });
  it("alert più vecchio di 30 minuti è degradato", () => {
    const b = classifyIngestion({ newestAlertIso: "2026-07-29T11:20:00Z", nowMs: ORA });
    assert.equal(b.verdict, "degraded");
  });
  it("eventi scartati sono degradato", () => {
    const b = classifyIngestion({ eventsDropped: 42, newestAlertIso: "2026-07-29T11:59:00Z", nowMs: ORA });
    assert.equal(b.verdict, "degraded");
  });
  it("nessun alert mai ricevuto non è 'allineata': lo dice onestamente e non è ok", () => {
    // Prima del fix: newestAlertIso null produceva verdict "ok" e headline
    // "allineata" — un semaforo verde falso su un'appliance appena installata
    // o su Wazuh mai configurato.
    const b = classifyIngestion({ newestAlertIso: null, nowMs: ORA });
    assert.notEqual(b.verdict, "ok");
    assert.equal(b.headline, "nessun alert ricevuto finora");
  });
  it("Wazuh non configurato produce configured:false, non un verde 'allineata'", () => {
    const b = classifyIngestion({ configured: false, nowMs: ORA });
    assert.equal(b.configured, false);
  });
});

describe("repliche", () => {
  const base = {
    schema_version: 1, generated_at: "2026-07-29T11:55:00Z", host: "srv",
    backend: { reachable: true, disk: { use_percent: "33%" } },
    local_disk: { use_percent: 57 },
    runs: { archive: { outcome: "success", failed: 0 }, retention: { outcome: "success" },
            verify: { outcome: "success", manifest_chain_valid: true } },
    archives: { newest: "2026-07-29T11:11:00Z" },
    retention_policy: {}, schedule: { archive_interval: "hourly" },
  } as never;

  it("replica recente e pulita è ok", () => {
    assert.equal(classifyReplication(base, ORA).verdict, "ok");
  });
  it("nessuna replica da oltre il doppio dell'intervallo è errore", () => {
    const s = { ...(base as object), archives: { newest: "2026-07-29T02:00:00Z" } } as never;
    assert.equal(classifyReplication(s, ORA).verdict, "fail");
  });
  it("upload falliti sono errore", () => {
    const s = { ...(base as object),
      runs: { ...(base as { runs: object }).runs, archive: { outcome: "partial", failed: 2 } } } as never;
    assert.equal(classifyReplication(s, ORA).verdict, "fail");
  });
  it("catena di integrità non valida è errore", () => {
    const s = { ...(base as object),
      runs: { ...(base as { runs: object }).runs, verify: { outcome: "failed", manifest_chain_valid: false } } } as never;
    assert.equal(classifyReplication(s, ORA).verdict, "fail");
  });
  it("disco della destinazione oltre l'85% è degradato", () => {
    const s = { ...(base as object), backend: { reachable: true, disk: { use_percent: "88%" } } } as never;
    assert.equal(classifyReplication(s, ORA).verdict, "degraded");
  });
  it("endpoint non configurato non è un errore", () => {
    const b = classifyReplication(null, ORA);
    assert.equal(b.configured, false);
    assert.equal(b.verdict, "ok");
  });
  it("archivio mai eseguito ma appena configurato è in attesa, non guasto", () => {
    const s = {
      ...(base as object),
      generated_at: "2026-07-29T11:58:00Z", // 2 minuti fa: entro la soglia di grazia
      runs: { ...(base as { runs: object }).runs, archive: { outcome: "never" } },
      archives: {}, // nessuna replica riuscita finora
    } as never;
    assert.equal(classifyReplication(s, ORA).verdict, "degraded");
  });
  it("archivio mai eseguito oltre la soglia di grazia è errore", () => {
    const s = {
      ...(base as object),
      generated_at: "2026-07-29T08:00:00Z", // 4 ore fa: oltre la soglia (min 3h)
      runs: { ...(base as { runs: object }).runs, archive: { outcome: "never" } },
      archives: {},
    } as never;
    assert.equal(classifyReplication(s, ORA).verdict, "fail");
  });
  it("outcome failed è errore subito, senza attendere la soglia di grazia", () => {
    const s = { ...(base as object),
      runs: { ...(base as { runs: object }).runs, archive: { outcome: "failed", failed: 0 } } } as never;
    assert.equal(classifyReplication(s, ORA).verdict, "fail");
  });
  it("archives.newest con microsecondi e senza Z (formato reale sul campo) viene interpretato", () => {
    const s = { ...(base as object), archives: { newest: "2026-07-29T11:59:58.544552" } } as never;
    assert.equal(classifyReplication(s, ORA).verdict, "ok");
  });
});
