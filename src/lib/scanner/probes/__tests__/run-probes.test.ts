import { describe, it } from "node:test";
import assert from "node:assert";
import { runAttributionProbes, type ProbeHostInput, type ProbeRunDeps } from "../run-probes";
import type { EvidenceInput } from "@/lib/attribution/types";

/** Deps di default per i test: nessun probe tocca la rete, nessuna evidenza reale scritta. */
function baseDeps(overrides?: Partial<ProbeRunDeps>): ProbeRunDeps {
  return {
    httpTls: async () => [],
    smb2: async () => null,
    mdns: async () => null,
    ssdp: async () => null,
    wsd: async () => null,
    getSetting: () => null,
    getNetworkById: () => ({ probes_enabled: 1 }),
    recordEvidence: () => 0,
    recomputeAttributionSafe: () => {},
    ...overrides,
  };
}

function host(id: number, openPorts: number[] = [80]): ProbeHostInput {
  return { id, ip: `10.0.0.${id}`, openPorts };
}

describe("runAttributionProbes — gating", () => {
  it("setting globale attribution_probes_enabled=0 → zero host probati, nessuna evidenza", async () => {
    let httpCalls = 0;
    const deps = baseDeps({
      getSetting: (k) => (k === "attribution_probes_enabled" ? "0" : null),
      httpTls: async () => { httpCalls++; return []; },
    });
    const r = await runAttributionProbes(1, [host(1), host(2)], { deps });
    assert.equal(r.hostsProbed, 0);
    assert.equal(r.evidenceWritten, 0);
    assert.equal(r.skipped, 2);
    assert.equal(httpCalls, 0);
  });

  it("setting globale 'false' (stringa) disabilita come '0'", async () => {
    const deps = baseDeps({ getSetting: () => "false" });
    const r = await runAttributionProbes(1, [host(1)], { deps });
    assert.equal(r.hostsProbed, 0);
    assert.equal(r.skipped, 1);
  });

  it("setting globale assente (null) → abilitato di default", async () => {
    const deps = baseDeps({ getSetting: () => null });
    const r = await runAttributionProbes(1, [host(1)], { deps });
    assert.equal(r.hostsProbed, 1);
  });

  it("override per rete networks.probes_enabled=0 → zero host probati anche con setting globale ON", async () => {
    let httpCalls = 0;
    const deps = baseDeps({
      getSetting: () => null,
      getNetworkById: () => ({ probes_enabled: 0 }),
      httpTls: async () => { httpCalls++; return []; },
    });
    const r = await runAttributionProbes(1, [host(1)], { deps });
    assert.equal(r.hostsProbed, 0);
    assert.equal(r.skipped, 1);
    assert.equal(httpCalls, 0);
  });

  it("host senza porte aperte non viene probato (gate 3)", async () => {
    const deps = baseDeps();
    const r = await runAttributionProbes(1, [host(1, []), host(2, [80])], { deps });
    assert.equal(r.hostsProbed, 1);
    assert.equal(r.skipped, 1);
  });

  it("gate illeggibile (eccezione) → fail-closed, zero host probati", async () => {
    const deps = baseDeps({
      getNetworkById: () => { throw new Error("db down"); },
    });
    const r = await runAttributionProbes(1, [host(1), host(2)], { deps });
    assert.equal(r.hostsProbed, 0);
    assert.equal(r.skipped, 2);
  });
});

describe("runAttributionProbes — budget e concorrenza", () => {
  it("allo scadere del budget si ferma e riporta gli host rimasti fuori (mai troncamento silenzioso)", async () => {
    const warnCalls: unknown[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnCalls.push(args); };
    try {
      const deps = baseDeps({
        // ogni probe impiega 30ms: con budget 20ms e concorrenza 1, solo il primo host completa
        httpTls: async () => { await new Promise((r) => setTimeout(r, 30)); return []; },
      });
      const hosts = [host(1), host(2), host(3)];
      const r = await runAttributionProbes(1, hosts, { deps, budgetMs: 20, concurrency: 1 });
      assert.ok(r.hostsProbed < hosts.length, `atteso hostsProbed < ${hosts.length}, trovato ${r.hostsProbed}`);
      assert.equal(r.hostsProbed + r.skipped, hosts.length);
      assert.ok(warnCalls.length >= 1, "atteso un console.warn per gli host rimasti fuori dal budget");
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("runAttributionProbes — scrittura evidenze", () => {
  it("unisce le evidenze di più probe e chiama recordEvidence una sola volta per host", async () => {
    const recordCalls: Array<{ hostId: number; inputs: EvidenceInput[] }> = [];
    const recomputeCalls: number[] = [];
    const deps = baseDeps({
      httpTls: async () => [
        {
          port: 443, scheme: "https", server: "MikroTik RouterOS", title: null, realm: null, location: null,
          tlsSubjectCn: null, tlsSan: [], tlsIssuer: null,
        },
      ],
      recordEvidence: (hostId, inputs) => { recordCalls.push({ hostId, inputs }); return inputs.length; },
      recomputeAttributionSafe: (hostId) => { recomputeCalls.push(hostId); },
    });
    const r = await runAttributionProbes(1, [host(1, [443])], { deps });
    assert.equal(recordCalls.length, 1, "recordEvidence deve essere chiamata esattamente una volta per host");
    assert.equal(recordCalls[0].hostId, 1);
    assert.ok(recordCalls[0].inputs.length > 0, "l'evidenza vendor da http-tls deve essere nell'input unico");
    assert.ok(recordCalls[0].inputs.some((i) => i.dimension === "vendor" && i.claim === "mikrotik"));
    assert.equal(recomputeCalls.length, 1);
    assert.equal(r.hostsProbed, 1);
    assert.equal(r.evidenceWritten, recordCalls[0].inputs.length);
  });

  it("nessuna evidenza da nessun probe → recordEvidence non viene chiamata per quell'host", async () => {
    let recordCalls = 0;
    const deps = baseDeps({ recordEvidence: () => { recordCalls++; return 0; } });
    const r = await runAttributionProbes(1, [host(1, [80])], { deps });
    assert.equal(recordCalls, 0);
    assert.equal(r.hostsProbed, 1);
    assert.equal(r.evidenceWritten, 0);
  });

  it("2 host con 3 evidenze ciascuno (smb2 category compute + httpTls vendor/category MikroTik) → evidenceWritten conta inserted+refreshed di OGNI host, non solo dell'ultimo", async () => {
    const recordCallsByHost: Record<number, number> = {};
    const deps = baseDeps({
      // build=0 → non plausibile come Windows (vedi isPlausibleWindowsVersion): solo category=compute (1 evidenza).
      smb2: async () => ({ osVersion: "6.1.0", netbiosName: null, dnsDomain: null, signingRequired: true }),
      // MikroTik → vendor=mikrotik + category=network.router (2 evidenze). Totale per host: 3.
      httpTls: async () => [
        {
          port: 443, scheme: "https", server: "MikroTik RouterOS", title: null, realm: null, location: null,
          tlsSubjectCn: null, tlsSan: [], tlsIssuer: null,
        },
      ],
      recordEvidence: (hostId, inputs) => {
        recordCallsByHost[hostId] = inputs.length;
        return inputs.length; // simula recordEvidenceRaw: tutte righe nuove → inserted === inputs.length
      },
    });
    const r = await runAttributionProbes(1, [host(1, [443, 445]), host(2, [443, 445])], { deps });
    assert.equal(r.hostsProbed, 2);
    assert.equal(recordCallsByHost[1], 3, "smb2 (category) + http-tls (vendor+category) = 3 evidenze per host");
    assert.equal(recordCallsByHost[2], 3);
    assert.equal(r.evidenceWritten, 6, "evidenceWritten deve sommare inserted+refreshed di TUTTI gli host probati, non riportare solo l'ultimo host");
  });

  it("un probe che rigetta la Promise non impedisce agli altri probe di scrivere evidenza", async () => {
    const recordCalls: EvidenceInput[][] = [];
    const deps = baseDeps({
      httpTls: async () => { throw new Error("connessione rifiutata"); },
      smb2: async () => ({ osVersion: "10.0.19041", netbiosName: null, dnsDomain: null, signingRequired: true }),
      recordEvidence: (_hostId, inputs) => { recordCalls.push(inputs); return inputs.length; },
    });
    const r = await runAttributionProbes(1, [host(1, [443, 445])], { deps });
    assert.equal(r.hostsProbed, 1);
    assert.equal(recordCalls.length, 1);
    assert.ok(recordCalls[0].some((i) => i.dimension === "os" && i.claim === "windows"));
  });
});
