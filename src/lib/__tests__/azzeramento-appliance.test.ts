/**
 * «Azzera l'appliance» (29/10/2026): solo su un'appliance da immagine che ha azzera.sh, solo col
 * nome scritto per intero, con systemd-run e senza shell.
 *
 * Run: node --import tsx --test src/lib/__tests__/azzeramento-appliance.test.ts
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { argomentiAzzeramento, avviaAzzeramento, statoAzzeramento, type EseguiComando } from "../azzeramento-appliance";

function appliance(opz: { versione?: boolean; azzera?: boolean; nome?: string } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "azzera-"));
  const conf = path.join(d, "etc");
  fs.mkdirSync(conf);
  if (opz.versione !== false) fs.writeFileSync(path.join(conf, "versione.json"), JSON.stringify({ versione: "2026.10.24" }));
  if (opz.nome) fs.writeFileSync(path.join(conf, "stato-voluto.yaml"), JSON.stringify({ nome: opz.nome, codcli: "70175" }));
  const azzera = path.join(d, "azzera.sh");
  if (opz.azzera !== false) fs.writeFileSync(azzera, "#!/bin/bash\n");
  return { conf, azzera };
}
const HOST = () => "79994-ipam";

describe("azzeramento dell'appliance", () => {
  test("disponibile su un'appliance da immagine con azzera.sh, nome dallo stato voluto", () => {
    const s = statoAzzeramento(appliance({ nome: "70175-ipam" }), HOST);
    assert.deepEqual(s, { disponibile: true, motivo: "", nome: "70175-ipam", immagine: "2026.10.24" });
  });

  test("senza stato voluto il nome è l'hostname", () => {
    assert.equal(statoAzzeramento(appliance(), HOST).nome, "79994-ipam");
  });

  test("non da immagine o immagine vecchia: non disponibile col perché", () => {
    assert.match(statoAzzeramento(appliance({ versione: false }), HOST).motivo, /appliance da immagine/);
    assert.match(statoAzzeramento(appliance({ azzera: false }), HOST).motivo, /Aggiorna/);
  });

  test("nome sbagliato: niente avviato", async () => {
    const chiamate: string[][] = [];
    const run: EseguiComando = async (_c, a) => { chiamate.push(a); return { codice: 0, stderr: "" }; };
    const e = await avviaAzzeramento("altro", appliance({ nome: "70175-ipam" }), run, HOST);
    assert.equal(e.ok, false);
    assert.equal(chiamate.length, 0);
  });

  test("nome giusto: systemd-run con l'unità sua, il nome come argomento a sé e --spegni", async () => {
    const p = appliance({ nome: "70175-ipam" });
    const chiamate: [string, string[]][] = [];
    const run: EseguiComando = async (c, a) => { chiamate.push([c, a]); return { codice: 0, stderr: "" }; };
    const e = await avviaAzzeramento(" 70175-ipam ", p, run, HOST);
    assert.deepEqual(e, { ok: true });
    assert.deepEqual(chiamate, [["systemd-run", argomentiAzzeramento(p.azzera, "70175-ipam")]]);
    assert.deepEqual(argomentiAzzeramento("/x/azzera.sh", "n"), ["--unit=da-azzera", "--collect", "--no-block", "--", "/bin/bash", "/x/azzera.sh", "--conferma", "n", "--spegni"]);
  });

  test("immagine vecchia: rifiutato anche col nome giusto", async () => {
    const run: EseguiComando = async () => { throw new Error("non doveva partire"); };
    const e = await avviaAzzeramento("70175-ipam", appliance({ nome: "70175-ipam", azzera: false }), run, HOST);
    assert.equal(e.ok, false);
  });
});
