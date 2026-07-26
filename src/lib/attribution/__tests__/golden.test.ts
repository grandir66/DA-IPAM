import { describe, it } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { emitEvidenceFromSignals } from "../emitters";
import type { AttributionSignals } from "../emitters";
import { fuseAttribution } from "../fuse";
import { phaseIndex } from "../types";
import type { AttributionEvidenceRow, EvidenceInput } from "../types";
import { ATTR_SOURCE_WEIGHTS } from "../weights";
import { categoryParent, isValidCategory } from "../taxonomy";
import type { CategorySlug } from "../taxonomy";

const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, "golden");
const NOW = new Date().toISOString();

function toRows(inputs: EvidenceInput[]): AttributionEvidenceRow[] {
  return inputs.map((e, i) => ({
    id: i + 1,
    host_id: 0,
    source: e.source,
    phase: e.phase,
    dimension: e.dimension,
    claim: e.claim,
    confidence: e.confidence,
    weight: e.weight ?? ATTR_SOURCE_WEIGHTS[e.source],
    raw_value: e.raw_value ?? null,
    observed_at: NOW,
    expires_at: e.expires_at ?? null,
    superseded_by: null,
  }));
}

describe("golden set (spec §8)", { skip: !existsSync(join(DIR, "expected.json")) }, () => {
  const hosts = JSON.parse(readFileSync(join(DIR, "hosts.json"), "utf8")) as AttributionSignals[];
  const expected = JSON.parse(readFileSync(join(DIR, "expected.json"), "utf8")) as Array<{
    ip: string;
    category: string | null;
    vendor: string | null;
    os: string | null;
  }>;

  it("nessun host golden peggiora", () => {
    let correctL2 = 0,
      withExpectedL2 = 0;
    for (const exp of expected) {
      const signals = hosts.find((h) => h.host.ip === exp.ip);
      assert.ok(signals, `host golden mancante in hosts.json: ${exp.ip}`);
      const r = fuseAttribution(toRows(emitEvidenceFromSignals(signals)), NOW);
      if (exp.vendor) assert.equal(r.vendor.claim, exp.vendor, `${exp.ip}: vendor`);
      if (exp.os) assert.equal(r.os.claim, exp.os, `${exp.ip}: os`);
      if (exp.category && exp.category.includes(".")) {
        withExpectedL2 += 1;
        if (r.category.claim === exp.category) correctL2 += 1;
        else {
          // tollerato SOLO il ripiego al livello 1 corretto, mai una famiglia diversa
          assert.equal(
            r.category.claim,
            categoryParent(exp.category as CategorySlug),
            `${exp.ip}: categoria`
          );
        }
      }
    }
    // metrica di accettazione spec §8: livello 2 corretto ≥ 85% sul golden set
    if (withExpectedL2 > 0) {
      assert.ok(correctL2 / withExpectedL2 >= 0.85, `livello 2 corretto ${correctL2}/${withExpectedL2} < 85%`);
    }
  });

  it("progressività: la fusione dopo la fase N non contraddice la fase N+1", () => {
    for (const signals of hosts) {
      const all = toRows(emitEvidenceFromSignals(signals));
      let prevClaim: string | null = null;
      for (let p = 0; p < 7; p++) {
        const upTo = all.filter((e) => phaseIndex(e.phase) <= p);
        const r = fuseAttribution(upTo, NOW);
        const claim = r.category.claim;
        if (prevClaim && claim && isValidCategory(prevClaim) && isValidCategory(claim)) {
          assert.ok(
            claim === prevClaim || categoryParent(claim as CategorySlug) === categoryParent(prevClaim as CategorySlug),
            `${signals.host.ip}: fase ${p} contraddice la precedente (${prevClaim} → ${claim})`
          );
        }
        if (claim) prevClaim = claim;
      }
    }
  });
});
