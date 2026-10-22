/**
 * A-IPAM, Task 6: il registro (audit) degli invii verso DA-Vul-can, modello
 * `accesso/registro-accessi.ts`: una riga JSONL per invio riuscito, scarto, fallimento
 * definitivo, sospensione e «Invia ora», in `<DATA_DIR>/audit/invii-vulcan-YYYY-MM-DD.jsonl`,
 * 400 giorni. Mai gettone, URL, IP o corpo: solo i campi della riga, sha256 a 12 caratteri.
 *
 * Cartella dati isolata: `support/data-dir-isolata` va importato PER PRIMO.
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GIORNI_REGISTRO_VULCAN, scriviRegistroVulcan, type RigaAuditVulcan } from "../registro";

const DIR = path.join(TEST_DATA_DIR, "audit");
const leggi = (giorno: string) =>
  fs
    .readFileSync(path.join(DIR, `invii-vulcan-${giorno}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((r) => JSON.parse(r) as Record<string, unknown>);

test("una riga per chiamata, con l'ora, nel file del giorno (UTC)", () => {
  const il = new Date("2026-10-22T23:30:00.000Z");
  scriviRegistroVulcan({ azione: "invio", tipo: "ad-health", http: 201, byte: 3000, oggetti: 15, sha: "a".repeat(64), risposta_id: "272" }, il);
  scriviRegistroVulcan({ azione: "scarto", tipo: "inventario", http: 404, motivo: "l'hub non riceve ancora l'inventario (404)" }, il);
  const righe = leggi("2026-10-22");
  assert.equal(righe.length, 2);
  assert.deepEqual(righe[0], {
    il: il.toISOString(),
    azione: "invio",
    tipo: "ad-health",
    http: 201,
    byte: 3000,
    oggetti: 15,
    sha: "aaaaaaaaaaaa",
    risposta_id: "272",
  });
  assert.equal(righe[1].azione, "scarto");
});

test("solo i campi della riga: chiavi estranee (gettone, url, corpo) non si scrivono", () => {
  const il = new Date("2026-10-21T10:00:00.000Z");
  const sporca = {
    azione: "sospeso",
    http: 401,
    motivo: "l'hub ha rifiutato il gettone (401)",
    token: "SEGRETO-SEGRETO-SEGRETO",
    url: "https://da-vulcan.esempio.invalid",
    corpo: '{"x":1}',
  } as unknown as RigaAuditVulcan;
  scriviRegistroVulcan(sporca, il);
  const testo = fs.readFileSync(path.join(DIR, "invii-vulcan-2026-10-21.jsonl"), "utf8");
  assert.ok(!testo.includes("SEGRETO"));
  assert.ok(!testo.includes("esempio.invalid"));
  assert.ok(!testo.includes('"corpo"'));
  assert.ok(testo.includes('"azione":"sospeso"'));
});

test("sha: al massimo 12 caratteri esadecimali, altro scartato", () => {
  const il = new Date("2026-10-20T10:00:00.000Z");
  scriviRegistroVulcan({ azione: "invio", sha: "0123456789abcdef0123" }, il);
  scriviRegistroVulcan({ azione: "invio", sha: "non-esadecimale!" }, il);
  const r = leggi("2026-10-20");
  assert.equal(r[0].sha, "0123456789ab");
  assert.equal(r[1].sha, undefined);
});

test("i file più vecchi di 400 giorni si tolgono al primo scritto del giorno", () => {
  fs.mkdirSync(DIR, { recursive: true });
  const vecchio = path.join(DIR, "invii-vulcan-2025-09-01.jsonl");
  const tenuto = path.join(DIR, "invii-vulcan-2025-10-01.jsonl");
  const altro = path.join(DIR, "accessi-2020-01-01.jsonl");
  for (const f of [vecchio, tenuto, altro]) fs.writeFileSync(f, "{}\n");
  assert.equal(GIORNI_REGISTRO_VULCAN, 400);
  scriviRegistroVulcan({ azione: "invia_ora", da: "admin" }, new Date("2026-10-25T08:00:00.000Z"));
  assert.ok(!fs.existsSync(vecchio), "oltre 400 giorni: tolto");
  assert.ok(fs.existsSync(tenuto), "entro 400 giorni: resta");
  assert.ok(fs.existsSync(altro), "i file degli altri registri non si toccano");
});
