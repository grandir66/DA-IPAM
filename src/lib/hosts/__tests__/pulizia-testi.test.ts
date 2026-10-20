/**
 * Le parole dell'interfaccia della pulizia (piano 2026-10-20, Task 6): l'esito di «Archivia» si dice per nome e
 * distingue il guasto a metà dal guasto della sola cancellazione dell'archivio scaduto; le date di «IP precedenti»
 * non dicono «fino al» quando la data è l'arrivo del MAC su quell'IP (nello storico `changed_at` è l'arrivo).
 *
 * Run: node --import tsx --test src/lib/hosts/__tests__/pulizia-testi.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { leggiRispostaApplica, dataIpPrecedente, scadenzaArchivio } from "@/lib/hosts/pulizia-testi";

const h = (id: number, nome: string, ip = `10.0.0.${id}`) => ({ id, ip, nome });

test("200: esito per nome", () => {
  const r = leggiRispostaApplica(200, { archiviati: [h(1, "PC-A")], nonPiuCandidati: [h(2, "PC-B")], cancellatiDallArchivio: [] });
  assert.equal(r.tipo, "ok");
  if (r.tipo === "ok") assert.deepEqual(r.archiviati.map((x) => x.nome), ["PC-A"]);
});

test("500 con nonArchiviati vuoto = solo la cancellazione dell'archivio è fallita", () => {
  const r = leggiRispostaApplica(500, { error: "x", archiviati: [h(1, "PC-A")], nonArchiviati: [], nonPiuCandidati: [] });
  assert.equal(r.tipo, "archivio_scaduto_fallito");
});

test("500 con nonArchiviati pieno = interrotta a metà", () => {
  const r = leggiRispostaApplica(500, { error: "x", archiviati: [h(1, "PC-A")], nonArchiviati: [h(2, "PC-B")], nonPiuCandidati: [] });
  assert.equal(r.tipo, "interrotta");
});

test("400 e corpi storti: errore col messaggio, mai un esito inventato", () => {
  assert.deepEqual(leggiRispostaApplica(400, { error: "Il numero confermato" }), { tipo: "rifiutata", messaggio: "Il numero confermato" });
  assert.equal(leggiRispostaApplica(200, { ciao: 1 }).tipo, "illeggibile");
  assert.equal(leggiRispostaApplica(502, null).tipo, "illeggibile");
});

test("data degli IP precedenti: storico = arrivo, archivio = ultima vista", () => {
  assert.equal(dataIpPrecedente("storico", "20/10/2026"), "arrivato il 20/10/2026");
  assert.equal(dataIpPrecedente("archivio", "20/10/2026"), "ultima vista il 20/10/2026");
});

test("scadenza dell'archivio: 90 giorni dopo", () => {
  assert.equal(scadenzaArchivio("2026-01-01 10:00:00", 90)?.toISOString(), "2026-04-01T10:00:00.000Z");
  assert.equal(scadenzaArchivio("rotta", 90), null);
});

test("motivo leggibile come nella scheda approvata", async () => {
  const { motivoLeggibile } = await import("@/lib/hosts/pulizia-testi");
  assert.equal(motivoLeggibile("assente", "assente da 100 giorni"), "Assente da 100 giorni");
  assert.equal(motivoLeggibile("cambio_ip", "ora 10.0.1.81"), "IP cambiato: ora 10.0.1.81");
  assert.equal(motivoLeggibile("assente", null), "Assente");
});
