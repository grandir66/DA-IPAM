import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OUTAGE_MIN_JOBS,
  buildSchedulerHealthMessage,
  composeSchedulerVerdict,
} from "@/lib/health/scheduler-health-notify";
import type { SchedulerJobRow } from "@/lib/health/scheduler-freshness";

const NOW = Date.parse("2026-09-02T22:00:00Z");

/** Job che ha girato poco fa: nei tempi. */
function fresco(over: Partial<SchedulerJobRow> = {}): SchedulerJobRow {
  return {
    job_type: "wazuh_sync",
    interval_minutes: 15,
    last_run: "2026-09-02 21:55:00",
    created_at: "2026-06-01 10:00:00",
    enabled: 1,
    ...over,
  };
}

/** Job fermo da ore: oltre la tolleranza di findStaleJobs. */
function fermo(over: Partial<SchedulerJobRow> = {}): SchedulerJobRow {
  return fresco({ last_run: "2026-09-02 18:00:00", ...over });
}

test("nessun job attivo: niente da sorvegliare, non un guasto", () => {
  const v = composeSchedulerVerdict([fresco({ enabled: 0 })], NOW);
  assert.equal(v.verdict, "ok");
  assert.match(v.headline, /nessun job attivo/);
});

test("job tutti nei tempi: ok", () => {
  const v = composeSchedulerVerdict([fresco(), fresco({ job_type: "vuln_sync" })], NOW);
  assert.equal(v.verdict, "ok");
  assert.match(v.headline, /2 job attivi/);
});

test("un job fermo su molti: degradato, non bloccato", () => {
  // meshcentral_sync rotto per conto suo non deve gridare "tutto fermo".
  const rows = [fermo({ job_type: "meshcentral_sync" }), fresco(), fresco({ job_type: "ad_sync" })];
  const v = composeSchedulerVerdict(rows, NOW);
  assert.equal(v.verdict, "degraded");
  assert.match(v.headline, /1 job su 3/);
  assert.match(v.headline, /meshcentral_sync/);
});

test("TUTTI i job fermi: e' un blocco totale, verdetto fail", () => {
  // La firma dell'incidente 2026-09-02: la causa e' comune, non di un job.
  const rows = [
    fermo({ job_type: "wazuh_sync" }),
    fermo({ job_type: "librenms_sync" }),
    fermo({ job_type: "vuln_sync" }),
    fermo({ job_type: "ad_sync" }),
  ];
  const v = composeSchedulerVerdict(rows, NOW);
  assert.equal(v.verdict, "fail");
  assert.match(v.headline, /tutti i 4 job/);
  // Il messaggio deve indirizzare al processo, non alle integrazioni.
  assert.match(v.headline, /CONTESTO TENANT CORROTTO/);
});

test("i job disabilitati non contano nel 'tutti fermi'", () => {
  const rows = [
    fermo({ job_type: "wazuh_sync" }),
    fermo({ job_type: "librenms_sync" }),
    fermo({ job_type: "vuln_sync" }),
    fresco({ job_type: "ad_sync" }),
    fermo({ job_type: "cleanup", enabled: 0 }),
  ];
  const v = composeSchedulerVerdict(rows, NOW);
  // 3 fermi su 4 abilitati: degradato, perche' uno gira ancora.
  assert.equal(v.verdict, "degraded");
  assert.match(v.headline, /3 job su 4/);
});

test(`sotto ${OUTAGE_MIN_JOBS} job "tutti fermi" resta degradato, non un blocco`, () => {
  // Un tenant con due soli job non merita un allarme grave per due ritardi.
  const rows = [fermo({ job_type: "wazuh_sync" }), fermo({ job_type: "vuln_sync" })];
  assert.equal(composeSchedulerVerdict(rows, NOW).verdict, "degraded");
});

test("un job che non ha MAI girato conta come fermo", () => {
  const rows = [fresco(), fresco({ job_type: "ad_sync" }), { ...fresco({ job_type: "librenms_sync" }), last_run: null }];
  const v = composeSchedulerVerdict(rows, NOW);
  assert.equal(v.verdict, "degraded");
  assert.match(v.headline, /librenms_sync/);
});

test("il messaggio non contiene segreti ne' indirizzi", () => {
  const m = buildSchedulerHealthMessage("fail", "tutti i 4 job del cliente sono fermi", "70791", "transizione");
  assert.match(m.subject, /\[70791\] Sincronizzazioni — bloccato/);
  assert.equal(/\d+\.\d+\.\d+\.\d+/.test(m.text), false, "nessun IP nel messaggio");
  assert.equal(/password|token|secret/i.test(m.text), false, "nessun segreto nel messaggio");
});
