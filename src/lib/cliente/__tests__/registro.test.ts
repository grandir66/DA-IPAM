/**
 * Registro delle schede della vista cliente: quali compaiono e in che ordine,
 * e l'ordine delle voci «Cosa richiede attenzione».
 *
 * Run: node --import tsx --test src/lib/cliente/__tests__/registro.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ContestoCliente } from "../contesto";
import {
  ordinaAttenzione,
  schedeAttive,
  type SchedaCliente,
  type VoceAttenzione,
} from "../registro";

const contesto = {
  tenantCode: "X",
  nomeCliente: "X",
  moduli: [],
  ora: new Date(0),
  amministratore: false,
} as ContestoCliente;

function scheda(parziale: Partial<SchedaCliente> & Pick<SchedaCliente, "id" | "ordine">): SchedaCliente {
  return {
    titolo: parziale.id,
    icona: "Circle",
    attiva: async () => true,
    riquadro: async () => ({ numero: "0", contesto: "", stato: "a_posto", aperti: 0 }),
    attenzione: async () => [],
    ...parziale,
  };
}

test("schedeAttive: una spenta, una che lancia, due in ordine inverso", async () => {
  const errori: string[] = [];
  const originale = console.error;
  console.error = (...args: unknown[]) => {
    errori.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const attive = await schedeAttive(contesto, [
      scheda({ id: "dopo", ordine: 20 }),
      scheda({ id: "spenta", ordine: 5, attiva: async () => false }),
      scheda({ id: "prima", ordine: 10 }),
      scheda({
        id: "rotta",
        ordine: 1,
        attiva: async () => {
          throw new Error("scheda rotta");
        },
      }),
    ]);
    assert.deepEqual(attive.map((s) => s.id), ["prima", "dopo"]);
    assert.equal(errori.length, 1);
    assert.match(errori[0] ?? "", /rotta/);
  } finally {
    console.error = originale;
  }
});

test("ordinaAttenzione: grave, attenzione, nota; a parità resta l'ordine d'arrivo", () => {
  const voci: VoceAttenzione[] = [
    { gravita: "nota", testo: "n1", href: "/cliente", scheda: "A" },
    { gravita: "grave", testo: "g1", href: "/cliente", scheda: "A" },
    { gravita: "attenzione", testo: "a1", href: "/cliente", scheda: "A" },
    { gravita: "grave", testo: "g2", href: "/cliente", scheda: "A" },
    { gravita: "nota", testo: "n2", href: "/cliente", scheda: "A" },
  ];
  assert.deepEqual(
    ordinaAttenzione(voci).map((v) => v.testo),
    ["g1", "g2", "a1", "n1", "n2"],
  );
});
