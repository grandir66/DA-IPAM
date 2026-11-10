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
        history: () => undefined,
      },
    );
    assert.deepEqual(ambito, [3, 4]);
    assert.deepEqual(r.avvii.map((x) => x.network_id), [3, 4]);
    assert.equal(r.saltati[0]?.network_id, 90);
  }
});
