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
