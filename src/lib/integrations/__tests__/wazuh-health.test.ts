import { test } from "node:test";
import assert from "node:assert/strict";
import { composeHealthBlocks, type WazuhHealthProbes } from "../wazuh-health";
import type { BlockHealth } from "../wazuh-health-thresholds";

function ok(key: BlockHealth["key"], headline = "ok"): BlockHealth {
  return { key, verdict: "ok", headline, configured: true };
}

function degraded(key: BlockHealth["key"], headline = "degraded"): BlockHealth {
  return { key, verdict: "degraded", headline, configured: true };
}

/** Probes di default tutti sani: i test modificano solo quelli che servono. */
function healthyProbes(overrides: Partial<WazuhHealthProbes> = {}): WazuhHealthProbes {
  return {
    manager: async () => ok("manager", "tutti i demoni attivi"),
    indexer: async () => degraded("indexer", "cluster giallo"),
    ingestion: async () => ok("ingestion", "allineata"),
    replication: async () => ok("replication", "ultima replica riuscita 1 ora fa"),
    ...overrides,
  };
}

test("un probe che lancia produce SOLO il suo blocco a fail; gli altri restano invariati", async () => {
  const probes = healthyProbes({
    indexer: async () => {
      throw new Error("ECONNREFUSED 192.168.4.19:9200");
    },
  });
  const blocks = await composeHealthBlocks(probes);

  const byKey = Object.fromEntries(blocks.map((b) => [b.key, b]));
  assert.equal(byKey.indexer.verdict, "fail");
  assert.match(byKey.indexer.headline, /ECONNREFUSED 192\.168\.4\.19:9200/);

  assert.equal(byKey.manager.verdict, "ok");
  assert.equal(byKey.manager.headline, "tutti i demoni attivi");
  assert.equal(byKey.ingestion.verdict, "ok");
  assert.equal(byKey.replication.verdict, "ok");
});

test("tutti e quattro i probe lanciano → quattro blocchi fail, nessuna eccezione propagata", async () => {
  const probes: WazuhHealthProbes = {
    manager: async () => { throw new Error("manager down"); },
    indexer: async () => { throw new Error("indexer down"); },
    ingestion: async () => { throw new Error("ingestion down"); },
    replication: async () => { throw new Error("replication down"); },
  };

  const blocks = await composeHealthBlocks(probes);

  assert.equal(blocks.length, 4);
  for (const b of blocks) {
    assert.equal(b.verdict, "fail");
    assert.ok(b.headline.length > 0);
  }
  const byKey = Object.fromEntries(blocks.map((b) => [b.key, b]));
  assert.match(byKey.manager.headline, /manager down/);
  assert.match(byKey.indexer.headline, /indexer down/);
  assert.match(byKey.ingestion.headline, /ingestion down/);
  assert.match(byKey.replication.headline, /replication down/);
});

test("blocco ingestione con indexer facoltativo non configurato resta configured:false, non diventa un errore (fix review Critical)", async () => {
  // Prima del fix: "indexer non configurato" e "indexer irraggiungibile"
  // producevano entrambi un verdetto fail in classifyIngestion. Questo test
  // copre esplicitamente la combinazione che mancava (wazuh-health.test.ts
  // esercitava solo sonde iniettate a mano, mai questo caso).
  const probes = healthyProbes({
    ingestion: async () => ({
      key: "ingestion",
      verdict: "ok",
      headline: "indexer non configurato: ingestione non verificabile (facoltativo)",
      configured: false,
    }),
  });

  const blocks = await composeHealthBlocks(probes);
  const ingestion = blocks.find((b) => b.key === "ingestion");
  assert.ok(ingestion);
  assert.equal(ingestion.configured, false);
  assert.equal(ingestion.verdict, "ok");
});

test("blocco repliche non configurato resta configured:false, non diventa un errore", async () => {
  const probes = healthyProbes({
    replication: async () => ({
      key: "replication",
      verdict: "ok",
      headline: "repliche non configurate — collega l'endpoint di stato nelle impostazioni",
      configured: false,
    }),
  });

  const blocks = await composeHealthBlocks(probes);
  const replication = blocks.find((b) => b.key === "replication");
  assert.ok(replication);
  assert.equal(replication.configured, false);
  assert.equal(replication.verdict, "ok");
});

test("l'ordine dei blocchi nel risultato è stabile: manager, indexer, ingestion, replication", async () => {
  const probes = healthyProbes();
  const blocks = await composeHealthBlocks(probes);
  assert.deepEqual(
    blocks.map((b) => b.key),
    ["manager", "indexer", "ingestion", "replication"],
  );
});
