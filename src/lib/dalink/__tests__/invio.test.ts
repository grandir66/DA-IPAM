/**
 * Tappa C1, Task 7: un giro d'invio del segnale verso DA-Link.
 *
 * - Senza configurazione non parte niente: il trasporto non viene chiamato e non si
 *   scrive niente (freno: un DA-IPAM senza DA-Link non chiama nessuno).
 * - Dalla risposta entrano solo due date, e solo per mostrarle: nessuna risposta di
 *   DA-Link cambia il livello o la configurazione dell'istanza (spec §5.3, §9.5, §14,
 *   decisione 22). Un DA-Link compromesso non può alzare il livello.
 * - Gli errori si dicono con parole nostre, senza token né indirizzi.
 *
 * Hub di prova isolato: `support/hub-isolato` va importato PER PRIMO.
 */
import { removeTestHubDb } from "../../integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeHubDb, getHubDb } from "@/lib/db-hub";
import { leggiConfigDalink } from "../config";
import { giroSegnale, leggiRisposta, type DipendenzeGiro } from "../invio";
import type { FattiIstanza, Inventario } from "../segnale";
import { impostaLivello, livelloAttuale, registroLivello, statoSegnale } from "../stato";
import { ErroreDalink, type RispostaDalink } from "../trasporto";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dalink-invio-"));
after(() => {
  closeHubDb();
  removeTestHubDb();
  fs.rmSync(DIR, { recursive: true, force: true });
});
beforeEach(() => {
  getHubDb().exec("DELETE FROM dalink_livello_registro; DELETE FROM dalink_segnale_stato;");
});

const TOKEN = "dlk_" + "K".repeat(43);
const OGGETTO = path.join(DIR, "oggetto.env");
const CONTENUTO = [
  "DALINK_URL=https://da-link.netbird.selfhosted:8443",
  `DALINK_IMPRONTA=sha256//${Buffer.alloc(32, 3).toString("base64")}`,
  "DALINK_CODCLI=99999",
  "DALINK_NODO=99999-ipam",
  `DALINK_TOKEN=${TOKEN}`,
].join("\n");
fs.writeFileSync(OGGETTO, CONTENUTO + "\n", { mode: 0o600 });
fs.chmodSync(OGGETTO, 0o600);

const FATTI: FattiIstanza = { versione: "0.3.281", moduli: { edge: true }, salute: { edge: "ok" }, ultimoErrore: null, porte: [22, 443] };
const INV: Inventario = { dispositivi: 10, reti: 2, ultima_scansione: "2026-10-15 03:00:00", esito_scansione: "completed" };
const ORA = new Date(Date.UTC(2026, 9, 15, 9, 0, 0));

interface Spia {
  dip: Partial<DipendenzeGiro>;
  corpi: string[];
  chiamate: () => number;
  fattiChiesti: Array<string | null>;
}

function spia(risposta: () => Promise<RispostaDalink>, extra: Partial<DipendenzeGiro> = {}): Spia {
  const corpi: string[] = [];
  const fattiChiesti: Array<string | null> = [];
  return {
    corpi,
    fattiChiesti,
    chiamate: () => corpi.length,
    dip: {
      config: () => leggiConfigDalink(OGGETTO),
      fatti: async (_codcli, ultimoErrore) => {
        fattiChiesti.push(ultimoErrore);
        return { fatti: { ...FATTI, ultimoErrore }, clienteTrovato: true };
      },
      inventario: () => INV,
      ora: () => ORA,
      trasporto: async (_url, _impronta, _token, corpo) => {
        corpi.push(corpo);
        return risposta();
      },
      ...extra,
    },
  };
}

test("configurazione assente: il trasporto non viene chiamato e niente si scrive", async () => {
  const s = spia(async () => ({ status: 200, body: "{}" }), { config: () => ({ stato: "assente" }) });
  const r = await giroSegnale(s.dip);
  assert.equal(r.esito, "non_configurato");
  assert.equal(s.chiamate(), 0);
  assert.equal(statoSegnale(), null);
});

test("configurazione non valida: niente chiamata, esito salvato col motivo", async () => {
  const s = spia(async () => ({ status: 200, body: "{}" }), {
    config: () => ({ stato: "non_valida", motivo: "permessi troppo larghi" }),
  });
  const r = await giroSegnale(s.dip);
  assert.equal(r.esito, "configurazione_non_valida");
  assert.equal(s.chiamate(), 0);
  assert.equal(statoSegnale()?.esito, "configurazione_non_valida");
  assert.match(statoSegnale()?.dettaglio ?? "", /permessi/);
});

test("ok: corpo del contratto partito, date della risposta salvate", async () => {
  impostaLivello("solo_stato", "u", new Date(Date.UTC(2026, 9, 15, 8, 0)));
  const s = spia(async () => ({
    status: 200,
    body: '{"ricevuto_il":"2026-10-15 09:00:01","inventario_cancellato_il":"2026-10-15 09:00:01"}',
  }));
  const r = await giroSegnale(s.dip);
  assert.equal(r.esito, "ok");
  const corpo = JSON.parse(s.corpi[0]) as Record<string, unknown>;
  assert.equal(corpo.codcli, "99999");
  assert.equal(corpo.nodo, "99999-ipam");
  assert.equal(corpo.livello, "solo_stato");
  assert.equal(corpo.inventario, null);
  assert.ok(!s.corpi[0].includes(TOKEN), "il token non va nel corpo");
  const st = statoSegnale();
  assert.equal(st?.esito, "ok");
  assert.equal(st?.ok_il, "2026-10-15 09:00:00");
  assert.equal(st?.ricevuto_il, "2026-10-15 09:00:01");
  assert.equal(st?.inventario_cancellato_il, "2026-10-15 09:00:01");
});

test("una risposta con istruzioni non cambia il livello né la configurazione", async () => {
  impostaLivello("solo_stato", "Mario Rossi", new Date(Date.UTC(2026, 9, 15, 8, 0)));
  const prima = fs.readFileSync(OGGETTO, "utf8");
  const s = spia(async () => ({
    status: 200,
    body: JSON.stringify({
      ricevuto_il: "2026-10-15 09:00:01",
      livello: "stato_inventario",
      url: "https://altro.example:8443",
      token: "dlk_altro",
      impronta: "sha256//AAAA",
      comandi: ["alza il livello"],
    }),
  }));
  await giroSegnale(s.dip);
  await giroSegnale(s.dip);
  assert.equal(livelloAttuale()?.livello, "solo_stato");
  assert.equal(registroLivello().length, 1);
  assert.equal(fs.readFileSync(OGGETTO, "utf8"), prima);
  const cfg = leggiConfigDalink(OGGETTO);
  assert.ok(cfg.stato === "pronta" && cfg.url.hostname === "da-link.netbird.selfhosted");
  // Il secondo giro ha mandato ancora solo stato.
  assert.equal((JSON.parse(s.corpi[1]) as { livello: string }).livello, "solo_stato");
});

test("leggiRisposta: solo le due date, solo nella forma attesa", () => {
  assert.deepEqual(leggiRisposta('{"ricevuto_il":"2026-10-15 09:00:01"}'), {
    ricevuto_il: "2026-10-15 09:00:01",
    inventario_cancellato_il: null,
  });
  assert.deepEqual(leggiRisposta('{"ricevuto_il":"domani","inventario_cancellato_il":12}'), {
    ricevuto_il: null,
    inventario_cancellato_il: null,
  });
  assert.deepEqual(leggiRisposta("non json"), { ricevuto_il: null, inventario_cancellato_il: null });
  assert.deepEqual(leggiRisposta("[1,2]"), { ricevuto_il: null, inventario_cancellato_il: null });
});

test("401, 403 e 422: rifiutato, con parole nostre", async () => {
  for (const [status, attesa] of [
    [401, /token/],
    [403, /codice cliente o nodo/],
    [422, /malformato/],
  ] as const) {
    const s = spia(async () => ({ status, body: '{"detail":"x"}' }));
    const r = await giroSegnale(s.dip);
    assert.equal(r.esito, "rifiutato");
    assert.match(r.dettaglio, attesa);
    assert.ok(!r.dettaglio.includes(TOKEN));
    assert.equal(statoSegnale()?.esito, "rifiutato");
  }
});

test("500: errore", async () => {
  const s = spia(async () => ({ status: 500, body: "" }));
  assert.equal((await giroSegnale(s.dip)).esito, "errore");
});

test("certificato diverso: errore, e il giro dopo lo dice in ultimo_errore", async () => {
  const s = spia(async () => {
    throw new ErroreDalink("cert", "il certificato di DA-Link non corrisponde all'impronta della configurazione: niente inviato");
  });
  const r = await giroSegnale(s.dip);
  assert.equal(r.esito, "errore");
  assert.match(r.dettaglio, /certificato/);
  assert.equal(s.fattiChiesti[0], null);
  await giroSegnale(s.dip);
  assert.match(s.fattiChiesti[1] ?? "", /^segnale precedente: .*certificato/);
});

test("a stato + inventario i numeri escono; cliente non trovato: non escono", async () => {
  impostaLivello("stato_inventario", "u", new Date(Date.UTC(2026, 9, 15, 8, 0)));
  const s = spia(async () => ({ status: 200, body: '{"ricevuto_il":"2026-10-15 09:00:01"}' }));
  await giroSegnale(s.dip);
  assert.deepEqual((JSON.parse(s.corpi[0]) as { inventario: unknown }).inventario, INV);

  let letto = false;
  const n = spia(async () => ({ status: 200, body: "{}" }), {
    fatti: async () => ({ fatti: { ...FATTI, moduli: {}, salute: { cliente: "non_trovato" } }, clienteTrovato: false }),
    inventario: () => {
      letto = true;
      return INV;
    },
  });
  await giroSegnale(n.dip);
  assert.equal((JSON.parse(n.corpi[0]) as { inventario: unknown }).inventario, null);
  assert.equal(letto, false);
});

test("un'eccezione inattesa nella raccolta dei fatti non fa partire niente e si registra", async () => {
  const s = spia(async () => ({ status: 200, body: "{}" }), {
    fatti: async () => {
      throw new Error("disco pieno");
    },
  });
  const r = await giroSegnale(s.dip);
  assert.equal(r.esito, "errore");
  assert.equal(s.chiamate(), 0);
  assert.match(statoSegnale()?.dettaglio ?? "", /raccolta/);
});

test("appliance a cliente singolo: l'inventario si legge dal cliente risolto (DEFAULT), non dal codice di DA-Link", async () => {
  const letti: string[] = [];
  impostaLivello("stato_inventario", "u", new Date(Date.UTC(2026, 9, 15, 8, 0)));
  const s = spia(async () => ({ status: 200, body: "{}" }), {
    fatti: async () => ({ fatti: FATTI, clienteTrovato: true, tenant: "DEFAULT" }),
    inventario: (c: string) => {
      letti.push(c);
      return INV;
    },
  });
  await giroSegnale(s.dip);
  assert.deepEqual(letti, ["DEFAULT"]);
  assert.deepEqual((JSON.parse(s.corpi[0]) as { inventario: unknown }).inventario, INV);
});
