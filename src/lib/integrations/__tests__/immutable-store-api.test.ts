import { describe, it } from "node:test";
import assert from "node:assert";
import { parseImmutableStoreState } from "../immutable-store-api";

const COMPLETO = {
  schema_version: 1, generated_at: "2026-07-29T10:22:57Z", host: "srv-wazuh",
  backend: { type: "qnap-nfs", reachable: true, message: "ok", destination: "/mnt/qnap-wazuh",
             disk: { size: "3.7T", used: "1.2T", available: "2.5T", use_percent: "33%" } },
  local_disk: { size_gb: 292, used_gb: 160, available_gb: 121, use_percent: 57 },
  runs: {
    archive: { last_finished_at: "2026-07-29T09:11:43Z", outcome: "success", uploaded: 3, failed: 0 },
    retention: { last_finished_at: "2026-07-29T03:00:31Z", outcome: "success" },
    verify: { last_finished_at: "2026-07-26T06:23:40Z", outcome: "success", manifest_chain_valid: true },
  },
  archives: { total: 512, total_size_gb: 41.7, newest: "2026-07-29T09:11:43Z" },
  retention_policy: { remote_days: 2555 },
  schedule: { archive_interval: "hourly" },
};

describe("parseImmutableStoreState", () => {
  it("accetta uno stato completo", () => {
    const s = parseImmutableStoreState(COMPLETO);
    assert.equal(s.host, "srv-wazuh");
    assert.equal(s.runs.archive.outcome, "success");
    assert.equal(s.archives.total, 512);
  });

  it("riempie le sezioni mancanti invece di lanciare", () => {
    const s = parseImmutableStoreState({ schema_version: 1, host: "x" });
    assert.equal(s.runs.archive.outcome, "never");
    assert.deepEqual(s.archives, {});
  });

  it("non lancia su input non oggetto", () => {
    const s = parseImmutableStoreState("non un oggetto");
    assert.equal(s.runs.verify.outcome, "never");
  });

  it("conserva l'esito fallito", () => {
    const s = parseImmutableStoreState({ ...COMPLETO,
      runs: { ...COMPLETO.runs, archive: { outcome: "failed", failed: 3, error: "NAS irraggiungibile" } } });
    assert.equal(s.runs.archive.outcome, "failed");
    assert.equal(s.runs.archive.error, "NAS irraggiungibile");
  });

  // Fix review "Minor": la spec §3 documenta backend.disk.use_percent come
  // NUMERO (33), l'endpoint reale oggi manda la stringa df -h ("11%"). Se
  // parseBackend accettasse solo la stringa, una versione conforme alla spec
  // spegnerebbe in silenzio la soglia disco 85/95% (verde falso).
  it("accetta backend.disk.use_percent anche come numero (formato spec §3)", () => {
    const s = parseImmutableStoreState({ ...COMPLETO,
      backend: { ...COMPLETO.backend, disk: { ...COMPLETO.backend.disk, use_percent: 33 } } });
    assert.equal(s.backend.disk?.use_percent, 33);
  });
});
