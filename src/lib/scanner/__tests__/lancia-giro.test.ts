/**
 * Lanciatore: Completo chiede conferma, Discovery senza rete no, dispatch ai motori iniettati.
 * Run: node --import tsx --test src/lib/scanner/__tests__/lancia-giro.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErroreLancio, lanciaGiro, leggiLancio } from "../lancia-giro";

test("Completo senza conferma è rifiutato", () => {
  assert.throws(
    () => leggiLancio({ tipo: "discovery", profilo: "completo", network_ids: [1] }),
    (e: unknown) => e instanceof ErroreLancio && /65\.535/.test(e.message),
  );
});

test("Completo con conferma passa", () => {
  const l = leggiLancio({ tipo: "discovery", profilo: "completo", network_ids: [4], conferma_completo: true });
  assert.equal(l.profilo, "completo");
  assert.deepEqual(l.reti, [4]);
});

test("Discovery senza reti è rifiutato; Sonda L2 no", () => {
  assert.throws(() => leggiLancio({ tipo: "discovery", profilo: "rapido" }), ErroreLancio);
  const l2 = leggiLancio({ tipo: "sonda_l2", profilo: "standard" });
  assert.equal(l2.reti.length, 0);
});

test("tipo o profilo sconosciuti", () => {
  assert.throws(() => leggiLancio({ tipo: "foo", profilo: "rapido" }), ErroreLancio);
  assert.throws(() => leggiLancio({ tipo: "discovery", profilo: "turbo", network_ids: [1] }), ErroreLancio);
});

test("Discovery chiama il motore con gli argomenti del profilo Rapido", async () => {
  const visti: Array<{ id: number; args: string; udp: string | null | undefined }> = [];
  const esito = await lanciaGiro(
    { tipo: "discovery", profilo: "rapido", network_ids: [7] },
    {
      tenant: () => "T",
      rete: (id) => ({ id, cidr: "10.0.0.0/24", name: "lan" }) as never,
      discovery: async (id, _tipo, args, _snmp, opts) => {
        visti.push({ id, args: String(args), udp: opts?.udpPorts });
        return { id: "job-1", progress: { status: "running" } } as never;
      },
    },
  );
  assert.equal(esito.avvii.length, 1);
  assert.equal(visti[0]!.id, 7);
  assert.match(visti[0]!.args, /-sT/);
  assert.equal(visti[0]!.udp, "");
});

test("Solo controlli passa prove_fabbrica al giro; senza levetta no", async () => {
  const visti: Array<{ proveFabbrica?: boolean } | undefined> = [];
  await lanciaGiro(
    { tipo: "controlli", profilo: "standard", network_ids: [3], prove_fabbrica: true },
    {
      tenant: () => "T",
      rete: (id) => ({ id }) as never,
      servizi: (_t, _n, o) => {
        visti.push(o);
        return true;
      },
      segui: () => "job-test",
      history: () => undefined,
    },
  );
  await lanciaGiro(
    { tipo: "controlli", profilo: "standard", network_ids: [3] },
    {
      tenant: () => "T",
      rete: (id) => ({ id }) as never,
      servizi: (_t, _n, o) => {
        visti.push(o);
        return true;
      },
      segui: () => "job-test",
      history: () => undefined,
    },
  );
  assert.equal(visti[0]?.proveFabbrica, true);
  assert.equal(visti[1]?.proveFabbrica, false);
});

test("timeout_ms e concorrenza fuori range o non interi sono rifiutati", () => {
  const base = { tipo: "discovery", profilo: "rapido", network_ids: [1] };
  for (const timeout_ms of [499, 60_001, 1500.5, "2000", 0]) {
    assert.throws(
      () => leggiLancio({ ...base, timeout_ms: timeout_ms as never }),
      (e: unknown) => e instanceof ErroreLancio && /timeout_ms/.test(e.message),
    );
  }
  for (const concorrenza of [0, 257, 8.5, "16"]) {
    assert.throws(
      () => leggiLancio({ ...base, concorrenza: concorrenza as never }),
      (e: unknown) => e instanceof ErroreLancio && /concorrenza/.test(e.message),
    );
  }
});

test("timeout_ms e concorrenza nel range passano; assenti restano assenti", () => {
  const senza = leggiLancio({ tipo: "discovery", profilo: "rapido", network_ids: [1] });
  assert.equal(senza.timeoutMs, undefined);
  assert.equal(senza.concorrenza, undefined);
  const con = leggiLancio({
    tipo: "discovery",
    profilo: "rapido",
    network_ids: [1],
    timeout_ms: 500,
    concorrenza: 256,
  });
  assert.equal(con.timeoutMs, 500);
  assert.equal(con.concorrenza, 256);
});

test("Discovery e controlli inoltrano timeout e concorrenza; senza campi niente override", async () => {
  const vistiD: Array<{ timeoutMs?: number; concorrenza?: number } | undefined> = [];
  await lanciaGiro(
    { tipo: "discovery", profilo: "rapido", network_ids: [7], timeout_ms: 3000, concorrenza: 8 },
    {
      tenant: () => "T",
      rete: (id) => ({ id, cidr: "10.0.0.0/24", name: "lan" }) as never,
      discovery: async (_id, _tipo, _args, _snmp, opts) => {
        vistiD.push({ timeoutMs: opts?.timeoutMs, concorrenza: opts?.concorrenza });
        return { id: "job-1", progress: { status: "running" } } as never;
      },
    },
  );
  await lanciaGiro(
    { tipo: "discovery", profilo: "rapido", network_ids: [7] },
    {
      tenant: () => "T",
      rete: (id) => ({ id, cidr: "10.0.0.0/24", name: "lan" }) as never,
      discovery: async (_id, _tipo, _args, _snmp, opts) => {
        vistiD.push({ timeoutMs: opts?.timeoutMs, concorrenza: opts?.concorrenza });
        return { id: "job-2", progress: { status: "running" } } as never;
      },
    },
  );
  assert.deepEqual(vistiD[0], { timeoutMs: 3000, concorrenza: 8 });
  assert.deepEqual(vistiD[1], { timeoutMs: undefined, concorrenza: undefined });

  const vistiS: Array<{ timeoutMs?: number; concorrenza?: number } | undefined> = [];
  await lanciaGiro(
    { tipo: "controlli", profilo: "standard", network_ids: [3], timeout_ms: 4000, concorrenza: 4 },
    {
      tenant: () => "T",
      rete: (id) => ({ id }) as never,
      servizi: (_t, _n, o) => {
        vistiS.push({ timeoutMs: o?.timeoutMs, concorrenza: o?.concorrenza });
        return true;
      },
      segui: () => "job-test",
      history: () => undefined,
    },
  );
  await lanciaGiro(
    { tipo: "controlli", profilo: "standard", network_ids: [3] },
    {
      tenant: () => "T",
      rete: (id) => ({ id }) as never,
      servizi: (_t, _n, o) => {
        vistiS.push({ timeoutMs: o?.timeoutMs, concorrenza: o?.concorrenza });
        return true;
      },
      segui: () => "job-test",
      history: () => undefined,
    },
  );
  assert.deepEqual(vistiS[0], { timeoutMs: 4000, concorrenza: 4 });
  assert.deepEqual(vistiS[1], { timeoutMs: undefined, concorrenza: undefined });
});

test("segmentazione già in corso → 409", async () => {
  await assert.rejects(
    () =>
      lanciaGiro(
        { tipo: "segmentazione", profilo: "standard" },
        { tenant: () => "T", segmentazione: () => false, history: () => undefined },
      ),
    (e: unknown) => e instanceof ErroreLancio && e.status === 409,
  );
});

test("syn senza privilegi, all senza conferma, auditor e auto_targets vuoto sono rifiutati", () => {
  assert.throws(
    () => leggiLancio({ tipo: "discovery", profilo: "rapido", network_ids: [1], tcp_ports: "all" }),
    ErroreLancio,
  );
  assert.throws(
    () => leggiLancio({ tipo: "discovery", profilo: "rapido", network_ids: [1], auto_targets: false }),
    ErroreLancio,
  );
  assert.throws(
    () => leggiLancio({ tipo: "segmentazione", profilo: "standard", protocollo: "icmp_echo" }),
    (e: unknown) => e instanceof ErroreLancio && /auditor/.test(e.message),
  );
});

test("Discovery inoltra scan_mode, rate, retries e i bersagli; syn senza root no", async () => {
  const visti: Array<{ args: string; opts?: { scanMode?: string; ratePps?: number; retries?: number; targetIps?: string[] } }> = [];
  await lanciaGiro(
    {
      tipo: "discovery",
      profilo: "rapido",
      network_ids: [7],
      scan_mode: "connect",
      rate_pps: 100,
      retries: 2,
      tcp_ports: "22,80",
      auto_targets: false,
      targets: "10.0.0.9",
    },
    {
      tenant: () => "T",
      rete: (id) => ({ id, cidr: "10.0.0.0/24", name: "lan" }) as never,
      discovery: async (_id, _tipo, args, _snmp, opts) => {
        visti.push({
          args: String(args),
          opts: { scanMode: opts?.scanMode, ratePps: opts?.ratePps, retries: opts?.retries, targetIps: opts?.targetIps },
        });
        return { id: "job-k", progress: { status: "running" } } as never;
      },
    },
  );
  assert.match(visti[0]!.args, /-p 22,80/);
  assert.match(visti[0]!.args, /--max-retries 2/);
  assert.match(visti[0]!.args, /--max-rate 100/);
  assert.equal(visti[0]!.opts?.scanMode, "connect");
  assert.deepEqual(visti[0]!.opts?.targetIps, ["10.0.0.9"]);

  await assert.rejects(
    () =>
      lanciaGiro(
        { tipo: "discovery", profilo: "rapido", network_ids: [7], scan_mode: "syn" },
        {
          tenant: () => "T",
          privilegi: () => false,
          rete: (id) => ({ id, cidr: "10.0.0.0/24", name: "lan" }) as never,
        },
      ),
    (e: unknown) => e instanceof ErroreLancio && /syn/.test(e.message),
  );
});

test("Sonda L2 con durata_s non aspetta in linea; segmentazione inoltra la sorgente", async () => {
  const attese: number[] = [];
  const r = await lanciaGiro(
    { tipo: "sonda_l2", profilo: "standard", durata_s: 30 },
    {
      tenant: () => "T",
      accendiTrunk: () => undefined,
      attendi: async (ms) => {
        attese.push(ms);
      },
      inTenant: async (_t, lavoro) => {
        await lavoro();
      },
      syncTrunk: async () => ({ osservazioni: 0, vlan: 0 }),
      history: () => undefined,
    },
  );
  assert.match(r.avvii[0]!.messaggio, /30 secondi/);
  assert.deepEqual(attese, [30_000]);

  let visto: { sourceNetworkId?: number; retiBersaglio?: number[]; protocollo?: string } | undefined;
  await lanciaGiro(
    { tipo: "segmentazione", profilo: "standard", source_network_id: 4, reti_bersaglio: [5, 6] },
    {
      tenant: () => "T",
      rete: (id) => ({ id, cidr: "10.0.0.0/24", name: "lan" }) as never,
      segmentazione: (_t, _c, o) => {
        visto = o;
        return true;
      },
      segui: () => "job-test",
      history: () => undefined,
    },
  );
  // protocollo "direct" è il default di leggiProtocolloSeg e lanciaGiro lo inoltra sempre
  // (asserzione storica non aggiornata quando è stato aggiunto il protocollo — già rossa su dev).
  assert.deepEqual(visto, { sourceNetworkId: 4, retiBersaglio: [5, 6], protocollo: "direct" });
});

test("le sonde conservano le reti scelte e scartano gli ID estranei", async () => {
  for (const tipo of ["controlli", "discovery"]) {
    let ambito: unknown;
    const r = await lanciaGiro(
      { tipo, profilo: "su_misura", fasi: ["sonde"], network_ids: [3, 4, 90] },
      {
        tenant: () => "T",
        rete: (id) => (id === 90 ? undefined : { id }) as never,
        servizi: (_t, scope) => {
          ambito = scope;
          return true;
        },
        segui: () => "job-test",
        history: () => undefined,
      },
    );
    assert.deepEqual(ambito, [3, 4]);
    assert.deepEqual(r.avvii.map((x) => x.network_id), [3, 4]);
    assert.equal(r.saltati[0]?.network_id, 90);
  }
});

test("Controlli e segmentazione agganciano il giro e restituiscono il job_id (pannello)", async () => {
  const seguiti: Array<{ scanType: string; etichetta?: string }> = [];
  const segui = (o: { scanType: string; etichetta?: string }) => {
    seguiti.push({ scanType: o.scanType, etichetta: o.etichetta });
    return `job-${o.scanType}`;
  };

  const ctrl = await lanciaGiro(
    { tipo: "controlli", profilo: "standard", network_ids: [3] },
    {
      tenant: () => "T",
      rete: (id) => ({ id, name: "lan" }) as never,
      servizi: () => true,
      segui: segui as never,
      history: () => undefined,
    },
  );
  assert.equal(ctrl.avvii[0]?.job_id, "job-controlli");
  assert.equal(seguiti[0]?.scanType, "controlli");
  assert.equal(seguiti[0]?.etichetta, "lan");

  const seg = await lanciaGiro(
    { tipo: "segmentazione", profilo: "standard", source_network_id: 4 },
    {
      tenant: () => "T",
      rete: (id) => ({ id, name: "vlan40" }) as never,
      segmentazione: () => true,
      segui: segui as never,
      history: () => undefined,
    },
  );
  assert.equal(seg.avvii[0]?.job_id, "job-segmentazione");
  assert.equal(seguiti[1]?.scanType, "segmentazione");
  assert.equal(seguiti[1]?.etichetta, "vlan40");
});

test("Solo controlli scrive la cronologia a giro finito, con cosa ha fatto", async () => {
  const righe: Array<{ status: string; duration_ms: number | null }> = [];
  let termine: ((r: never) => void) | undefined;
  await lanciaGiro(
    { tipo: "controlli", profilo: "standard", network_ids: [3] },
    {
      tenant: () => "T",
      rete: (id) => ({ id }) as never,
      servizi: (_t, _n, o) => {
        termine = o?.alTermine as never;
        return true;
      },
      segui: () => "job-test",
      history: (r) => void righe.push({ status: r.status, duration_ms: r.duration_ms }),
    },
  );
  assert.equal(righe.length, 0);
  termine?.({ host: 37, sondati: 90, risposte: 84, controlli: 12, durataMs: 25000, errore: null } as never);
  assert.match(righe[0]!.status, /90 servizi già noti risondati su 37 host, 84 rispondono/);
  assert.equal(righe[0]!.duration_ms, 25000);
  termine?.({ host: 0, sondati: 0, risposte: 0, controlli: 0, durataMs: 5, errore: null } as never);
  assert.match(righe[1]!.status, /serve prima una Discovery/);
});
