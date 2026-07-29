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
  it("cluster giallo con numero di nodi assente resta degradato (comportamento di oggi preservato)", () => {
    assert.equal(classifyIndexer({ status: "yellow" }, []).verdict, "degraded");
  });
  it("cluster rosso a nodo singolo resta errore (invariato)", () => {
    assert.equal(classifyIndexer({ status: "red", number_of_nodes: 1 }, []).verdict, "fail");
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

  // Difetto 3 del brief fix-indexer: dato reale (appliance Domarc, indexer
  // Wazuh) — stato yellow, 1 nodo, 450 shard attivi, 29 non assegnati, 0 in
  // inizializzazione. Su un cluster a un solo nodo gli shard replica non
  // possono mai essere assegnati (nessun secondo nodo su cui copiarli):
  // l'installazione Wazuh predefinita è single-node, quindi prima del fix
  // questo blocco nasceva ambra e non tornava mai verde per nessuna azione
  // dell'operatore.
  describe("giallo a nodo singolo (dato reale)", () => {
    it("1. yellow, 1 nodo, 0 in inizializzazione, dischi sani → ok, con il motivo in detail", () => {
      const b = classifyIndexer(
        { status: "yellow", number_of_nodes: 1, initializing_shards: 0 },
        [{ node: "n1", diskPercent: 40 }],
      );
      assert.equal(b.verdict, "ok");
      assert.ok(b.headline.includes("giallo"), "l'intestazione continua a dire il colore reale");
      assert.ok(b.detail?.some((d) => d.includes("nodo singolo") && d.includes("giallo strutturale")));
    });

    it("2. yellow, 3 nodi → degradato (invariato: lì il giallo indica repliche davvero non assegnate)", () => {
      const b = classifyIndexer(
        { status: "yellow", number_of_nodes: 3, initializing_shards: 0 },
        [],
      );
      assert.equal(b.verdict, "degraded");
    });

    it("3. yellow, 1 nodo, shard in inizializzazione → degradato (non ancora a riposo)", () => {
      const b = classifyIndexer(
        { status: "yellow", number_of_nodes: 1, initializing_shards: 2 },
        [],
      );
      assert.equal(b.verdict, "degraded");
    });

    it("4. yellow, numero di nodi assente → degradato (comportamento di oggi preservato)", () => {
      const b = classifyIndexer(
        { status: "yellow", initializing_shards: 0 },
        [],
      );
      assert.equal(b.verdict, "degraded");
    });

    it("5. yellow, 1 nodo, ma un nodo al 96% di disco → errore (il disco non viene mascherato dal giallo strutturale)", () => {
      const b = classifyIndexer(
        { status: "yellow", number_of_nodes: 1, initializing_shards: 0 },
        [{ node: "n1", diskPercent: 96 }],
      );
      assert.equal(b.verdict, "fail");
    });

    it("6. red, 1 nodo → errore (invariato)", () => {
      const b = classifyIndexer(
        { status: "red", number_of_nodes: 1, initializing_shards: 0 },
        [],
      );
      assert.equal(b.verdict, "fail");
    });
  });
});

describe("ingestione", () => {
  it("alert recente nell'indexer è ok", () => {
    const b = classifyIngestion({ newestIndexerAlertIso: "2026-07-29T11:50:00Z", nowMs: ORA });
    assert.equal(b.verdict, "ok");
  });
  it("alert più vecchio di 30 minuti è degradato", () => {
    const b = classifyIngestion({ newestIndexerAlertIso: "2026-07-29T11:20:00Z", nowMs: ORA });
    assert.equal(b.verdict, "degraded");
  });
  it("eventi scartati sono degradato", () => {
    const b = classifyIngestion({ eventsDropped: 42, newestIndexerAlertIso: "2026-07-29T11:59:00Z", nowMs: ORA });
    assert.equal(b.verdict, "degraded");
  });
  it("nessun alert mai ricevuto (indice vuoto) non è 'allineata': lo dice onestamente e non è ok", () => {
    // Prima del fix: newestAlertIso null produceva verdict "ok" e headline
    // "allineata" — un semaforo verde falso su un'appliance appena installata
    // o su Wazuh mai configurato.
    const b = classifyIngestion({ newestIndexerAlertIso: null, nowMs: ORA });
    assert.notEqual(b.verdict, "ok");
    assert.equal(b.headline, "nessun alert ricevuto finora");
  });
  it("Wazuh non configurato produce configured:false, non un verde 'allineata'", () => {
    const b = classifyIngestion({ configured: false, nowMs: ORA });
    assert.equal(b.configured, false);
  });

  // Difetto 2 del brief fix-misure: il verdetto misurava
  // wazuh_alert_event.last_seen_at (tabella locale DA-IPAM), non l'indexer.
  // La sincronizzazione scarta gli alert non rilevanti (upsertAlertEvent
  // "skipped", filtri self/deviceRuleIds): la tabella locale avanza solo
  // quando arriva un alert interessante, quindi può restare indietro di ore
  // su un'ingestione Wazuh perfettamente sana. Dati reali osservati:
  // indexer @timestamp di 13 minuti fa, tabella DA-IPAM ferma a 41 ore.
  it("indexer con alert di 13 minuti fa è ok anche con la tabella DA-IPAM ferma a 41 ore (dato reale)", () => {
    const indexerRecente = new Date(ORA - 13 * 60_000).toISOString();
    const importatoVecchio = new Date(ORA - 41 * 3_600_000).toISOString();
    const b = classifyIngestion({
      newestIndexerAlertIso: indexerRecente,
      latestImportedAlertIso: importatoVecchio,
      nowMs: ORA,
    });
    assert.equal(b.verdict, "ok");
    assert.ok(b.detail?.some((d) => d.includes("ultimo alert rilevante importato")));
  });
  it("indexer non raggiungibile non produce un 'ok' inventato", () => {
    // `undefined` (non `null`): l'indexer non è stato interrogabile, non
    // sappiamo se ci sono alert o no — diverso da "indice vuoto".
    const b = classifyIngestion({ newestIndexerAlertIso: undefined, nowMs: ORA });
    assert.notEqual(b.verdict, "ok");
  });

  // Fix review Critical: prima di questo fix "indexer non configurato" e
  // "indexer configurato ma irraggiungibile" producevano ENTRAMBI
  // newestIndexerAlertIso undefined → verdict "fail". Un tenant con manager
  // sano e indexer (facoltativo) non configurato vedeva il blocco
  // ingestione rosso per sempre — la stessa classe di difetto che questo
  // fix doveva eliminare, spostata da un blocco all'altro. `indexerConfigured`
  // distingue esplicitamente i due casi, coerentemente con come
  // `classifyIndexer`/`probeIndexer` già trattano la propria assenza.
  it("indexer non configurato (facoltativo) non produce nessun allarme, come fa classifyIndexer per il proprio blocco", () => {
    const b = classifyIngestion({ indexerConfigured: false, eventsDropped: 0, nowMs: ORA });
    assert.equal(b.verdict, "ok");
    assert.equal(b.configured, false);
  });
  it("indexer configurato ma irraggiungibile resta un guasto, distinto da 'non configurato'", () => {
    const b = classifyIngestion({ indexerConfigured: true, newestIndexerAlertIso: undefined, nowMs: ORA });
    assert.notEqual(b.verdict, "ok");
    assert.equal(b.configured, true);
  });
});

describe("repliche", () => {
  const base = {
    schema_version: 1, generated_at: "2026-07-29T11:55:00Z", host: "srv",
    backend: { reachable: true, disk: { use_percent: "33%" } },
    local_disk: { use_percent: 57 },
    runs: { archive: { outcome: "success", failed: 0, last_finished_at: "2026-07-29T11:50:00Z" },
            retention: { outcome: "success" },
            verify: { outcome: "success", manifest_chain_valid: true } },
    archives: { newest: "2026-07-29T11:11:00Z" },
    retention_policy: {}, schedule: { archive_interval: "hourly" },
  } as never;

  it("replica recente e pulita è ok", () => {
    assert.equal(classifyReplication(base, ORA).verdict, "ok");
  });
  it("nessun ciclo di archiviazione da oltre la soglia (last_finished_at fermo) è errore", () => {
    // Segnale primario ora è il CICLO (last_finished_at), non più il
    // prodotto (archives.newest): un ciclo fermo da 10h su intervallo
    // orario (soglia 3h) è un guasto anche se `archives.newest` non è dato.
    const s = { ...(base as object),
      runs: { ...(base as { runs: object }).runs,
              archive: { outcome: "success", failed: 0, last_finished_at: "2026-07-29T02:00:00Z" } } } as never;
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
  it("archives.newest con microsecondi e senza Z (formato reale sul campo) viene interpretato per la staleness di lungo periodo", () => {
    const s = { ...(base as object),
      archives: { newest: "2026-07-29T11:59:58.544552" },
      retention_policy: { days_before_archive: 1 } } as never;
    assert.equal(classifyReplication(s, ORA).verdict, "ok");
  });
});

// Difetto 1 del brief fix-misure: `classifyReplication` misurava la
// "freschezza" dall'età di `archives.newest`. Dati reali (appliance Domarc,
// Wazuh 192.168.4.19, sistema SANO): il ciclo gira ogni ora e riesce, ma con
// `days_before_archive: 1` un log viene archiviato solo dopo un giorno —
// `archives.newest` resta legittimamente indietro di oltre 24h e la soglia
// di 3h era strutturalmente inarrivabile (blocco rosso per sempre).
describe("repliche — Difetto 1 (dati reali)", () => {
  const NOW_REALE = Date.parse("2026-07-29T19:00:00Z");

  function statoReale(overrides: {
    archiveLastFinishedAt?: string;
    newest?: string | null;
    daysBeforeArchive?: number;
  } = {}) {
    return {
      schema_version: 1, generated_at: "2026-07-29T18:50:30Z", host: "wazuh-domarc",
      backend: { reachable: true, disk: { use_percent: "11%" } },
      local_disk: { use_percent: 42 },
      runs: {
        archive: {
          last_finished_at: overrides.archiveLastFinishedAt ?? "2026-07-29T18:50:25Z",
          outcome: "success",
          archives_created: 0,
        },
        retention: { outcome: "success" },
        verify: { outcome: "success", manifest_chain_valid: true },
      },
      archives: { newest: overrides.newest ?? "2026-07-29T14:12:58.544552" },
      retention_policy: {
        remote_days: 365,
        mode: "qnap-nfs",
        days_before_archive: overrides.daysBeforeArchive,
        days_keep_local: 30,
      },
      schedule: { archive_interval: "hourly" },
    } as never;
  }

  it("1. ciclo success alle 18:50 + archives.newest alle 14:12 + days_before_archive:1 → ok (lo scenario che oggi accende il rosso)", () => {
    const s = statoReale({ daysBeforeArchive: 1 });
    assert.equal(classifyReplication(s, NOW_REALE).verdict, "ok");
  });

  it("2. archives.newest vecchio di 5 giorni con days_before_archive:1 → fail", () => {
    const cinqueGiorniFa = new Date(NOW_REALE - 5 * 24 * 3_600_000).toISOString();
    const s = statoReale({ newest: cinqueGiorniFa, daysBeforeArchive: 1 });
    assert.equal(classifyReplication(s, NOW_REALE).verdict, "fail");
  });

  it("3. days_before_archive assente + archives.newest vecchio di 5 giorni + ciclo recente success → ok (nessun fail deducibile)", () => {
    const cinqueGiorniFa = new Date(NOW_REALE - 5 * 24 * 3_600_000).toISOString();
    const s = statoReale({ newest: cinqueGiorniFa });
    assert.equal(classifyReplication(s, NOW_REALE).verdict, "ok");
  });

  it("4. ciclo success ma concluso 9 ore fa con intervallo orario → fail (il ciclo è fermo)", () => {
    const noveOreFa = new Date(NOW_REALE - 9 * 3_600_000).toISOString();
    const s = statoReale({ archiveLastFinishedAt: noveOreFa, daysBeforeArchive: 1 });
    assert.equal(classifyReplication(s, NOW_REALE).verdict, "fail");
  });
});
