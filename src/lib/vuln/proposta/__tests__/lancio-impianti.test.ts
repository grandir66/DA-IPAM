/**
 * Lancio «Per device» con gli impianti (piano profili-per-device, Passo 9, 08/11/2026; tavola oggetto 35).
 *
 * Perché: Riccardo vuole che anche gli impianti si possano scansionare dalla scheda «Per device», ma solo col consenso
 * scritto del cliente e solo con Greenbone. Il consenso lo controlla la sonda; qui si prova che DA-IPAM manda il gruppo
 * «IoT e OT» solo se chiesto, con `anche_impianti`, chi lo lancia, Veloce, senza nuclei né moduli.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/vuln/proposta/__tests__/lancio-impianti.test.ts
 */
import "@/lib/vuln/__tests__/support/dati-isolati";
import { test } from "node:test";
import assert from "node:assert/strict";
import { lanciaGruppiConfermati, type DipendenzeLancio } from "@/lib/vuln/proposta/lancio";
import type { GruppoPerEdge } from "@/lib/vuln/gruppi-edge";

function deps(chiamate: GruppoPerEdge[], impianti = ["10.9.0.50", "10.9.0.51"]): Partial<DipendenzeLancio> {
  return {
    proposte: () => [],
    host: () => [],
    contesi: () => new Set(),
    catalogo: async () => ({ profili: [], avviso: null }),
    avvia: async (_n, g) => { chiamate.push(g); return { stato: "lanciato", scan_id: 7, status: "running", ip_tolti: [] }; },
    registra: () => {},
    impianti: () => impianti,
  };
}

test("gli impianti partono solo se chiesti, col segno e chi, Veloce e solo Greenbone", async () => {
  const chiamate: GruppoPerEdge[] = [];
  const e = await lanciaGruppiConfermati(1, deps(chiamate), { famiglie: ["impianti"], chi: "riccardo" });
  assert.equal(chiamate.length, 1);
  assert.deepEqual(chiamate[0], { ips: ["10.9.0.50", "10.9.0.51"], profile: "fast", nuclei_profilo: null, assessment_profile_id: null, anche_impianti: true, chi: "riccardo" });
  assert.equal(e.gruppi[0].famiglia, "impianti");
});

test("senza «impianti» fra le famiglie nessun gruppo di impianti; rete senza impianti lo dice", async () => {
  const chiamate: GruppoPerEdge[] = [];
  await lanciaGruppiConfermati(1, deps(chiamate), { famiglie: ["linux"], chi: "r" });
  assert.equal(chiamate.length, 0);
  const vuota = await lanciaGruppiConfermati(1, deps(chiamate, []), { famiglie: ["impianti"], chi: "r" });
  assert.equal(chiamate.length, 0);
  assert.ok(vuota.avvisi.includes("IoT e OT: nessun impianto in questa rete."));
});
