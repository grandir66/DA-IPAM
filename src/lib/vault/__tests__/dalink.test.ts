/**
 * Vault semplice, passo 6 (piano DA-Link `2026-10-29-vault-passo6-app.md`, S1): backend `dalink` dietro `SecretStore`.
 * L'hub chiede le password a DA-Link (le quattro rotte della 8443, contratto `2026-10-27-vault-gettone-app-design.md`)
 * invece che a OpenBao, col gettone dell'app e il pinning dell'impronta SPKI del certificato.
 *
 * Si prova ogni riga dei «Vincoli globali» del piano e i casi 1-4:
 * 1. DA-Link spento all'avvio: nessuna cache, stato non pronto col motivo, letture rifiutate;
 * 2. DA-Link che torna dopo 23 ore: la cache si riempie, nessuna voce persa;
 * 3. ambito con 0 voci quando la cache ne aveva: accettato solo su 200, mai su errore;
 * 4. impronta sbagliata: nessun byte inviato, il gettone non esce.
 * Il gettone non deve mai comparire in `stato()`, nei messaggi d'errore, nel log; il corpo delle risposte nemmeno.
 *
 * Contro un DA-Link finto (`support/dalink-finto.ts`) col TLS vero e la sua impronta vera; orologio delle prove per
 * l'età della cache.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/dalink.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer as createTcpServer, type AddressInfo } from "node:net";
import { DaLinkStore, type ConfigDaLink } from "../dalink";
import { ErroreVault } from "../tipi";
import { creaDaLinkFinto, MARCA_CORPO, type DaLinkFinto } from "./support/dalink-finto";
import { certificatoDiProva } from "@/lib/dalink/__tests__/support/certificato";
import { normalizzaImpronta } from "@/lib/dalink/config";

const MIN = 60_000;
const ORA = 60 * MIN;
const PASSWORD = "Pw-di-prova-dalink-91!";
const COMMUNITY = "comm-di-prova-33";

let adesso = Date.parse("2026-10-29T08:00:00Z");
const ora = () => adesso;
let finto: DaLinkFinto;

function store(extra: Partial<ConfigDaLink> = {}): DaLinkStore {
  return new DaLinkStore({ url: finto.url, gettone: finto.gettone, impronta: finto.impronta, ora, ...extra });
}

async function portaChiusa(): Promise<string> {
  const s = createTcpServer();
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((ok) => s.close(() => ok()));
  return `https://127.0.0.1:${port}`;
}

async function erroreDi(p: Promise<unknown> | (() => unknown)): Promise<ErroreVault> {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    assert.ok(e instanceof ErroreVault, `atteso ErroreVault, arrivato ${String(e)}`);
    return e;
  }
  assert.fail("doveva rifiutare");
}

async function codiceDi(p: Promise<unknown> | (() => unknown)): Promise<string> {
  return (await erroreDi(p)).codice;
}

/** Tutto quello che passa da console durante `fn`. */
async function console_(fn: () => Promise<unknown>): Promise<string> {
  const righe: string[] = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(orig) as Array<keyof typeof orig>) {
    console[k] = (...a: unknown[]) => {
      righe.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    };
  }
  try {
    await fn().catch(() => undefined);
  } finally {
    Object.assign(console, orig);
  }
  return righe.join("\n");
}

const dopoIlGiro = () => new Promise((r) => setTimeout(r, 150));
const richiesteA = (pezzo: string) => finto.richieste.filter((r) => r.url.startsWith(pezzo));

beforeEach(async () => {
  adesso = Date.parse("2026-10-29T08:00:00Z");
  finto = await creaDaLinkFinto();
  finto.scriviDaFuori("app/da-ipam/encryption", { chiave: "chiave-di-prova" });
  finto.scriviDaFuori("app/da-ipam/integrazioni/librenms", { token: "tok-librenms-55" });
  finto.scriviDaFuori("clienti/70001/da-ipam/router-1", { username: "admin", password: PASSWORD });
  finto.scriviDaFuori("clienti/70001/da-ipam/switch-2", { snmp_community: COMMUNITY });
  finto.scriviDaFuori("app/da-vulcan/altro", { password: "non-mia" }); // fuori ambito: DA-Link non la dà
});

afterEach(async () => {
  await finto.chiudi();
});

describe("cache dell'ambito", () => {
  it("un giro (GET /api/v1/vault/ambito col gettone) carica l'ambito; le letture dopo non chiamano DA-Link", async () => {
    const s = store();
    assert.equal(s.backend, "dalink");
    await s.aggiorna();
    assert.equal(finto.richieste.length, 1);
    assert.equal(finto.richieste[0].metodo, "GET");
    assert.equal(finto.richieste[0].url, "/api/v1/vault/ambito");
    assert.equal(finto.richieste[0].auth, `Bearer ${finto.gettone}`);
    assert.deepEqual(s.leggiSync("clienti/70001/da-ipam/router-1"), { username: "admin", password: PASSWORD });
    assert.deepEqual(s.leggiSync("app/da-ipam/integrazioni/librenms"), { token: "tok-librenms-55" });
    assert.deepEqual(await s.get("app/da-ipam/encryption"), { chiave: "chiave-di-prova" });
    assert.equal(finto.richieste.length, 1, "nessuna richiesta in più: si legge dalla cache");
    const st = s.stato();
    assert.ok(st.pronto && st.aggiornatoAlle === adesso && !st.degradato);
  });

  it("prima del primo giro: leggiSync non_pronto, stato non pronto", async () => {
    const s = store();
    assert.equal(await codiceDi(() => s.leggiSync("app/da-ipam/encryption")), "non_pronto");
    assert.equal(s.stato().pronto, false);
  });

  it("caso 1 — DA-Link spento all'avvio: nessuna cache, stato non pronto col motivo, letture rifiutate", async () => {
    const s = store({ url: await portaChiusa() });
    const e = await erroreDi(s.aggiorna());
    assert.equal(e.codice, "non_raggiungibile");
    assert.equal(await codiceDi(() => s.leggiSync("app/da-ipam/encryption")), "non_raggiungibile");
    assert.equal(await codiceDi(s.get("app/da-ipam/encryption")), "non_raggiungibile");
    assert.equal(await codiceDi(s.list("clienti")), "non_raggiungibile");
    const st = s.stato();
    assert.equal(st.pronto, false);
    assert.ok(!st.pronto && /DA-Link/.test(st.motivo) && /mai/.test(st.motivo), !st.pronto ? st.motivo : "");
  });

  it("una voce cambiata in DA-Link si vede al giro dopo; una tolta sparisce", async () => {
    const s = store();
    await s.aggiorna();
    finto.scriviDaFuori("app/da-ipam/encryption", { chiave: "chiave-nuova" });
    finto.voci.delete("clienti/70001/da-ipam/switch-2");
    await s.aggiorna();
    assert.deepEqual(s.leggiSync("app/da-ipam/encryption"), { chiave: "chiave-nuova" });
    await dopoIlGiro(); // nessun giro per mancanza ancora in volo dal leggiSync sotto
    assert.equal(await codiceDi(() => s.leggiSync("clienti/70001/da-ipam/switch-2")), "non_trovato");
  });

  it("caso 3 — 200 con 0 voci: si accetta (l'app può aver cancellato tutto), la cache si svuota", async () => {
    const s = store();
    await s.aggiorna();
    finto.voci.clear();
    await s.aggiorna();
    assert.equal(await codiceDi(() => s.leggiSync("app/da-ipam/encryption")), "non_trovato");
    assert.deepEqual(await s.list("clienti"), []);
    assert.equal(s.stato().pronto, true);
  });

  it("caso 3 — 503, risposta illeggibile o voci non in forma: la cache piena resta piena, lo stato dice degradato", async () => {
    const s = store();
    await s.aggiorna();
    adesso += 10 * MIN;
    finto.giu = true;
    assert.equal(await codiceDi(s.aggiorna()), "non_raggiungibile");
    finto.giu = false;
    for (const body of ["non è json", '{"voci": []}', '{"letto_il": "x"}', "null"]) {
      finto.forza = () => ({ status: 200, body });
      await erroreDi(s.aggiorna());
    }
    finto.forza = null;
    assert.deepEqual(s.leggiSync("clienti/70001/da-ipam/router-1"), { username: "admin", password: PASSWORD });
    assert.equal((await s.list("clienti/70001")).length, 2);
    const st = s.stato();
    assert.ok(st.pronto && st.degradato && /DA-Link/.test(st.degradato), JSON.stringify(st));
  });

  it("caso 3 — un 200 con voci illeggibili per forma non tocca la cache: la voce di prima resta; tutte illeggibili = giro fallito", async () => {
    const s = store();
    await s.aggiorna();
    const router = "clienti/70001/da-ipam/router-1";
    const switch2 = "clienti/70001/da-ipam/switch-2";
    // Una voce illeggibile (versione stringa) fra voci buone: la sua voce di prima resta, le altre si aggiornano.
    finto.forza = () => ({
      status: 200,
      body: JSON.stringify({
        voci: {
          [router]: { valori: { password: "rotta" }, versione: "9" },
          [switch2]: { valori: { snmp_community: "nuova" }, versione: 7 },
          "../fuori": { valori: { a: "b" }, versione: 1 },
        },
      }),
    });
    await s.aggiorna();
    assert.deepEqual(s.leggiSync(router), { username: "admin", password: PASSWORD }, "la voce illeggibile non è stata toccata");
    assert.deepEqual(s.leggiSync(switch2), { snmp_community: "nuova" });
    assert.equal(await codiceDi(() => s.leggiSync("app/da-ipam/encryption")), "non_trovato", "una voce che manca dalla risposta esce, come oggi");
    await dopoIlGiro();
    // Tutte le voci ricevute illeggibili: risposta malformata, cache tenuta, stato degradato.
    finto.forza = () => ({ status: 200, body: JSON.stringify({ voci: { [router]: { valori: { password: "p" }, versione: "1" } } }) });
    assert.equal(await codiceDi(s.aggiorna()), "non_raggiungibile");
    assert.deepEqual(s.leggiSync(router), { username: "admin", password: PASSWORD });
    assert.equal((await s.list("clienti/70001")).length, 2);
    const st = s.stato();
    assert.ok(st.pronto && st.degradato, JSON.stringify(st));
    // Percorsi non validi soltanto (forma buona): scartati come oggi, il giro riesce.
    finto.forza = () => ({ status: 200, body: JSON.stringify({ voci: { "../fuori": { valori: { a: "b" }, versione: 1 } } }) });
    await s.aggiorna();
    assert.deepEqual(await s.list("clienti/70001"), []);
  });

  it("24 ore dall'ultimo giro riuscito (di serie): a 23h59 si legge, oltre no; lo stato lo dice", async () => {
    const s = store();
    await s.aggiorna();
    finto.giu = true;
    adesso += 23 * ORA + 59 * MIN;
    await erroreDi(s.aggiorna());
    assert.deepEqual(s.leggiSync("app/da-ipam/encryption"), { chiave: "chiave-di-prova" });
    assert.deepEqual(await s.get("app/da-ipam/encryption"), { chiave: "chiave-di-prova" });
    adesso += 2 * MIN;
    assert.equal(await codiceDi(() => s.leggiSync("app/da-ipam/encryption")), "non_raggiungibile");
    assert.equal(await codiceDi(s.get("app/da-ipam/encryption")), "non_raggiungibile");
    const st = s.stato();
    assert.equal(st.pronto, false);
    assert.ok(!st.pronto && /24 ore/.test(st.motivo), !st.pronto ? st.motivo : "");
  });

  it("24 ore per voce: una voce che arriva malformata a ogni giro scade 24 ore dopo la sua ultima lettura buona, le altre no", async () => {
    // Condizione del passo 7 (revisione del 29/10): con le 24 ore contate dal giro, una voce tenuta perché arrivata
    // malformata non scadeva mai, perché ogni giro riuscito (grazie alle altre voci) rinfrescava la cache intera.
    const s = store();
    await s.aggiorna(); // ultima lettura buona di tutte: 08:00
    const router = "clienti/70001/da-ipam/router-1";
    const switch2 = "clienti/70001/da-ipam/switch-2";
    const buone = ["app/da-ipam/encryption", "app/da-ipam/integrazioni/librenms", switch2];
    // Da qui DA-Link dà il router malformato, al giro e a GET /voce; le altre voci arrivano buone.
    finto.forza = (r) => {
      if (r.url === "/api/v1/vault/ambito") {
        const voci: Record<string, unknown> = { [router]: { valori: { password: "rotta" }, versione: "9" } };
        for (const p of buone) voci[p] = finto.voci.get(p);
        return { status: 200, body: JSON.stringify({ voci }) };
      }
      if (r.url.includes(encodeURIComponent(router))) return { status: 200, body: JSON.stringify({ valori: { password: "rotta" }, versione: "9" }) };
      return null;
    };
    await console_(async () => {
      for (let h = 1; h <= 23; h++) {
        adesso += ORA;
        await s.aggiorna(); // riesce: le altre voci sono buone
      }
    });
    const dopoIGiri = s.stato();
    assert.ok(dopoIGiri.pronto && !dopoIGiri.degradato && dopoIGiri.aggiornatoAlle === adesso, "i 23 giri sono riusciti");
    adesso += 59 * MIN; // 23h59 dall'ultima lettura buona del router
    assert.deepEqual(s.leggiSync(router), { username: "admin", password: PASSWORD }, "entro le 24 ore la voce tenuta si legge");
    adesso += 2 * MIN; // 24h01
    assert.equal(await codiceDi(() => s.leggiSync(router)), "non_raggiungibile");
    assert.equal(await codiceDi(s.get(router)), "non_raggiungibile");
    for (const p of buone) assert.ok(s.leggiSync(p), `${p}: letta buona al giro di un'ora fa, si legge`);
    await console_(() => s.aggiorna()); // un giro riuscito non rinfresca la voce arrivata malformata
    assert.equal(await codiceDi(() => s.leggiSync(router)), "non_raggiungibile");
    assert.ok(s.stato().pronto, "lo stato resta quello del giro: pronto");
    // DA-Link torna a darla buona: la lettura puntuale la rinfresca.
    finto.forza = null;
    assert.deepEqual(await s.get(router), { username: "admin", password: PASSWORD });
    assert.deepEqual(s.leggiSync(router), { username: "admin", password: PASSWORD });
  });

  it("24 ore per voce: una voce scritta (put) vale 24 ore dalla scrittura, anche se i giri falliscono da prima", async () => {
    const s = store();
    await s.aggiorna(); // 08:00
    adesso += 2 * ORA;
    await s.put("clienti/70003/da-ipam/ap", { password: "ap-1" }); // 10:00
    finto.giu = true;
    adesso += 23 * ORA; // 25 ore dal giro, 23 dalla scrittura
    await erroreDi(s.aggiorna());
    assert.deepEqual(s.leggiSync("clienti/70003/da-ipam/ap"), { password: "ap-1" });
    assert.equal(await codiceDi(() => s.leggiSync("app/da-ipam/encryption")), "non_raggiungibile");
    adesso += 2 * ORA; // 25 ore dalla scrittura
    assert.equal(await codiceDi(() => s.leggiSync("clienti/70003/da-ipam/ap")), "non_raggiungibile");
  });

  it("caso 2 — DA-Link torna dopo 23 ore: la cache si riempie, nessuna voce persa", async () => {
    const s = store();
    await s.aggiorna();
    const prima = (await s.list("app/da-ipam")).concat(await s.list("clienti"));
    finto.giu = true;
    for (let h = 1; h <= 23; h++) {
      adesso += ORA;
      await erroreDi(s.aggiorna());
    }
    assert.equal(s.stato().pronto, true);
    finto.giu = false;
    await s.aggiorna();
    const dopo = (await s.list("app/da-ipam")).concat(await s.list("clienti"));
    assert.deepEqual(dopo, prima);
    assert.equal(dopo.length, 4);
    adesso += 23 * ORA; // la cache conta di nuovo da questo giro
    assert.deepEqual(s.leggiSync("clienti/70001/da-ipam/switch-2"), { snmp_community: COMMUNITY });
    const st = s.stato();
    assert.ok(st.pronto);
  });

  it("list(prefisso) dalla cache: percorsi completi, in ordine, solo sotto il prefisso, nessuna chiamata", async () => {
    const s = store();
    await s.aggiorna();
    const n = finto.richieste.length;
    assert.deepEqual(await s.list("clienti/70001"), ["clienti/70001/da-ipam/router-1", "clienti/70001/da-ipam/switch-2"]);
    assert.deepEqual(await s.list("app/da-ipam"), ["app/da-ipam/encryption", "app/da-ipam/integrazioni/librenms"]);
    assert.deepEqual(await s.list("app/da-ipam/encr"), [], "il prefisso è una cartella, non un pezzo di nome");
    assert.equal(finto.richieste.length, n);
  });

  it("un percorso non valido è rifiutato prima di chiamare DA-Link", async () => {
    const s = store();
    for (const p of ["../sys", "/clienti/c1", "Clienti/C1", "clienti//c1", "clienti/c1/../x"]) {
      assert.equal(await codiceDi(s.get(p)), "percorso_non_valido", p);
      assert.equal(await codiceDi(s.put(p, { a: "b" })), "percorso_non_valido", p);
      assert.equal(await codiceDi(s.delete(p)), "percorso_non_valido", p);
    }
    assert.equal(finto.richieste.length, 0);
  });

  it("voce nuova con l'app accesa: la prima lettura fa partire un giro (uno), la successiva la trova", async () => {
    const s = store();
    await s.aggiorna();
    finto.scriviDaFuori("clienti/70002/da-ipam/fw", { password: "nuova-77" });
    assert.throws(() => s.leggiSync("clienti/70002/da-ipam/fw"), /ricaricamento .*avviato/);
    for (let i = 0; i < 5; i++) assert.throws(() => s.leggiSync("clienti/70002/da-ipam/fw"));
    await dopoIlGiro();
    assert.equal(richiesteA("/api/v1/vault/ambito").length, 2, "un giro solo per sei mancanze");
    assert.deepEqual(s.leggiSync("clienti/70002/da-ipam/fw"), { password: "nuova-77" });
  });
});

describe("get per conto di una persona (la «mostra password»)", () => {
  it("va sempre a GET /api/v1/vault/voce, anche con la cache fresca, e dà il valore di DA-Link", async () => {
    const s = store();
    await s.aggiorna();
    finto.scriviDaFuori("clienti/70001/da-ipam/router-1", { username: "admin", password: "cambiata-ora" });
    const v = await s.get("clienti/70001/da-ipam/router-1", { perConto: "mario.rossi", perContoId: "12" });
    assert.deepEqual(v, { username: "admin", password: "cambiata-ora" });
    const ultime = finto.richieste.slice(1);
    assert.equal(ultime.length, 1);
    assert.equal(ultime[0].metodo, "GET");
    assert.equal(ultime[0].url, "/api/v1/vault/voce?percorso=clienti%2F70001%2Fda-ipam%2Frouter-1");
    assert.equal(ultime[0].auth, `Bearer ${finto.gettone}`);
  });

  it("DA-Link giù: nessun ripiego sulla cache", async () => {
    const s = store();
    await s.aggiorna();
    finto.giu = true;
    assert.equal(await codiceDi(s.get("clienti/70001/da-ipam/router-1", { perConto: "mario.rossi" })), "non_raggiungibile");
  });

  it("voce assente o fuori ambito: non_trovato", async () => {
    const s = store();
    await s.aggiorna();
    assert.equal(await codiceDi(s.get("clienti/70001/da-ipam/manca", { perConto: "mario.rossi" })), "non_trovato");
    assert.equal(await codiceDi(s.get("app/da-vulcan/altro", { perConto: "mario.rossi" })), "non_trovato");
  });
});

describe("get dalla cache solo dopo il primo giro (come DA-Vul-can)", () => {
  const P = "clienti/70003/da-ipam/ap";

  it("prima del primo giro una voce appena scritta con put non si ridà dalla cache: la get va a DA-Link", async () => {
    const s = store();
    await s.put(P, { password: "mia" });
    finto.scriviDaFuori(P, { password: "da-fuori" });
    assert.deepEqual(await s.get(P), { password: "da-fuori" });
    assert.equal(finto.richieste.filter((r) => r.metodo === "GET" && r.url.startsWith("/api/v1/vault/voce")).length, 1);
  });

  it("prima del primo giro con DA-Link giù: non_pronto, mai la voce della put", async () => {
    const s = store();
    await s.put(P, { password: "mia" });
    finto.giu = true;
    assert.equal(await codiceDi(s.get(P)), "non_pronto");
  });

  it("prima del primo giro, giri falliti: non_raggiungibile «mai caricati», mai la voce della put", async () => {
    const s = store();
    await s.put(P, { password: "mia" });
    finto.giu = true;
    await erroreDi(s.aggiorna());
    const e = await erroreDi(s.get(P));
    assert.equal(e.codice, "non_raggiungibile");
    assert.match(e.message, /mai stati caricati/);
  });

  it("dopo il primo giro la voce fresca si ridà dalla cache, e DA-Link giù ripiega sulla cache", async () => {
    const s = store();
    await s.aggiorna();
    const prima = finto.richieste.length;
    assert.deepEqual(await s.get("clienti/70001/da-ipam/router-1"), { username: "admin", password: PASSWORD });
    assert.equal(finto.richieste.length, prima, "nessuna chiamata: voce fresca");
    adesso += 6 * MIN;
    finto.giu = true;
    assert.deepEqual(await s.get("clienti/70001/da-ipam/router-1"), { username: "admin", password: PASSWORD });
  });
});

describe("leggiDalVivo: sempre GET /voce, mai la cache, niente scritto in cache", () => {
  it("dà il valore di DA-Link anche con la cache fresca, e la cache resta com'era", async () => {
    const s = store();
    await s.aggiorna();
    finto.scriviDaFuori("clienti/70001/da-ipam/router-1", { username: "admin", password: "cambiata-ora" });
    assert.deepEqual(await s.leggiDalVivo("clienti/70001/da-ipam/router-1"), { username: "admin", password: "cambiata-ora" });
    assert.deepEqual(s.leggiSync("clienti/70001/da-ipam/router-1"), { username: "admin", password: PASSWORD });
  });

  it("DA-Link giù o voce assente: errore dichiarato, nessun ripiego sulla cache", async () => {
    const s = store();
    await s.aggiorna();
    assert.equal(await codiceDi(s.leggiDalVivo("clienti/70001/da-ipam/manca")), "non_trovato");
    assert.equal(await codiceDi(() => s.leggiDalVivo("../x")), "percorso_non_valido");
    finto.giu = true;
    assert.equal(await codiceDi(s.leggiDalVivo("clienti/70001/da-ipam/router-1")), "non_raggiungibile");
  });
});

describe("scrittura e cancellazione con la versione attesa", () => {
  it("put di una voce nuova manda versione_attesa 0; la cache prende la versione nuova", async () => {
    const s = store();
    await s.aggiorna();
    await s.put("clienti/70003/da-ipam/ap", { password: "ap-1" });
    const put = richiesteA("/api/v1/vault/voce").filter((r) => r.metodo === "PUT");
    assert.equal(put.length, 1);
    assert.deepEqual(JSON.parse(put[0].corpo), { percorso: "clienti/70003/da-ipam/ap", valori: { password: "ap-1" }, versione_attesa: 0 });
    assert.deepEqual(s.leggiSync("clienti/70003/da-ipam/ap"), { password: "ap-1" });
    assert.deepEqual(finto.voci.get("clienti/70003/da-ipam/ap"), { valori: { password: "ap-1" }, versione: 1 });
  });

  it("put di una voce in cache manda la sua versione; due scritture di fila senza ricaricare", async () => {
    const s = store();
    await s.aggiorna();
    await s.put("clienti/70001/da-ipam/router-1", { username: "admin", password: "seconda" });
    await s.put("clienti/70001/da-ipam/router-1", { username: "admin", password: "terza" });
    const put = finto.richieste.filter((r) => r.metodo === "PUT").map((r) => (JSON.parse(r.corpo) as { versione_attesa: number }).versione_attesa);
    assert.deepEqual(put, [1, 2]);
    assert.deepEqual(s.leggiSync("clienti/70001/da-ipam/router-1"), { username: "admin", password: "terza" });
    assert.equal(richiesteA("/api/v1/vault/ambito").length, 1);
  });

  it("409: ricarica la voce, errore chiaro, nessun secondo tentativo; la scrittura dopo riesce", async () => {
    const s = store();
    await s.aggiorna();
    finto.scriviDaFuori("clienti/70001/da-ipam/router-1", { username: "admin", password: "da-fuori" });
    const e = await erroreDi(s.put("clienti/70001/da-ipam/router-1", { username: "admin", password: "mia" }));
    assert.equal(e.codice, "rifiutato");
    assert.match(e.message, /cambiat/);
    assert.match(e.message, /clienti\/70001\/da-ipam\/router-1/);
    assert.ok(!e.message.includes(MARCA_CORPO));
    assert.equal(finto.richieste.filter((r) => r.metodo === "PUT").length, 1, "nessun secondo tentativo automatico");
    assert.deepEqual(finto.voci.get("clienti/70001/da-ipam/router-1")?.valori.password, "da-fuori", "la voce d'altri non è stata sovrascritta");
    assert.equal(finto.richieste.at(-1)?.url, "/api/v1/vault/voce?percorso=clienti%2F70001%2Fda-ipam%2Frouter-1", "la voce è stata ricaricata");
    assert.deepEqual(s.leggiSync("clienti/70001/da-ipam/router-1"), { username: "admin", password: "da-fuori" });
    await s.put("clienti/70001/da-ipam/router-1", { username: "admin", password: "mia" });
    assert.equal(finto.voci.get("clienti/70001/da-ipam/router-1")?.valori.password, "mia");
  });

  it("put di una voce «nuova» che invece c'è (cache mai caricata): 409, nessuna sovrascrittura", async () => {
    const s = store();
    assert.equal(await codiceDi(s.put("clienti/70001/da-ipam/switch-2", { snmp_community: "x" })), "rifiutato");
    assert.equal(finto.voci.get("clienti/70001/da-ipam/switch-2")?.valori.snmp_community, COMMUNITY);
  });

  it("delete con la versione della cache: 204, la voce esce dalla cache", async () => {
    const s = store();
    await s.aggiorna();
    await s.delete("clienti/70001/da-ipam/switch-2");
    const del = finto.richieste.filter((r) => r.metodo === "DELETE");
    assert.equal(del.length, 1);
    assert.equal(del[0].url, "/api/v1/vault/voce?percorso=clienti%2F70001%2Fda-ipam%2Fswitch-2&versione_attesa=1");
    assert.equal(finto.voci.has("clienti/70001/da-ipam/switch-2"), false);
    assert.deepEqual(await s.list("clienti/70001"), ["clienti/70001/da-ipam/router-1"]);
  });

  it("delete in conflitto: 409, voce ricaricata, rifiutato, nessun secondo tentativo", async () => {
    const s = store();
    await s.aggiorna();
    finto.scriviDaFuori("clienti/70001/da-ipam/switch-2", { snmp_community: "altra" });
    assert.equal(await codiceDi(s.delete("clienti/70001/da-ipam/switch-2")), "rifiutato");
    assert.equal(finto.richieste.filter((r) => r.metodo === "DELETE").length, 1);
    assert.ok(finto.voci.has("clienti/70001/da-ipam/switch-2"));
    assert.deepEqual(s.leggiSync("clienti/70001/da-ipam/switch-2"), { snmp_community: "altra" });
  });

  it("delete di una voce che non c'è (404): riuscita, e la voce esce dalla cache (cancellare è idempotente)", async () => {
    const s = store();
    await s.aggiorna();
    // La cache la ha ancora, DA-Link no (cancellata da un altro): il 404 dice che l'effetto voluto c'è già.
    finto.voci.delete("clienti/70001/da-ipam/switch-2");
    await s.delete("clienti/70001/da-ipam/switch-2");
    assert.ok(!(await s.list("clienti/70001")).includes("clienti/70001/da-ipam/switch-2"));
    await s.delete("clienti/70001/da-ipam/mai-esistita");
    assert.equal(finto.richieste.filter((r) => r.metodo === "DELETE").length, 2);
  });

});

describe("un giro in volo non sovrascrive una scrittura fatta nel frattempo", () => {
  /** Avvia un giro e lo tiene a metà: la fotografia di DA-Link è già presa, la risposta arriva quando si chiama `rilascia`. */
  async function giroTenutoAMeta(s: DaLinkStore): Promise<{ giro: Promise<void>; rilascia: () => void }> {
    let rilascia = () => undefined as void;
    const rilasciata = new Promise<void>((ok) => (rilascia = ok));
    let arrivata = () => undefined as void;
    const inizio = new Promise<void>((ok) => (arrivata = ok));
    finto.trattieniAmbito = { inizio: arrivata, rilascia: rilasciata };
    const giro = s.aggiorna();
    await inizio;
    finto.trattieniAmbito = null;
    return { giro, rilascia };
  }

  it("put durante il giro: il valore scritto resta, non torna quello letto prima", async () => {
    const s = store();
    await s.aggiorna();
    const router = "clienti/70001/da-ipam/router-1";
    const { giro, rilascia } = await giroTenutoAMeta(s);
    await s.put(router, { username: "admin", password: "scritta-adesso" });
    await s.put("clienti/70003/da-ipam/ap", { password: "ap-nuovo" });
    rilascia();
    await giro;
    assert.deepEqual(s.leggiSync(router), { username: "admin", password: "scritta-adesso" });
    assert.deepEqual(s.leggiSync("clienti/70003/da-ipam/ap"), { password: "ap-nuovo" });
    // La versione in cache è quella nuova: la scrittura dopo non va in conflitto.
    await s.put(router, { username: "admin", password: "ancora" });
    assert.equal(finto.voci.get(router)?.valori.password, "ancora");
  });

  it("delete durante il giro: la voce cancellata non rientra in cache", async () => {
    const s = store();
    await s.aggiorna();
    const sw = "clienti/70001/da-ipam/switch-2";
    const { giro, rilascia } = await giroTenutoAMeta(s);
    await s.delete(sw);
    rilascia();
    await giro;
    assert.ok(!(await s.list("clienti/70001")).includes(sw));
    await dopoIlGiro();
  });

  it("il giro dopo rilegge tutto da DA-Link (la protezione vale solo per il giro in volo)", async () => {
    const s = store();
    await s.aggiorna();
    const router = "clienti/70001/da-ipam/router-1";
    const { giro, rilascia } = await giroTenutoAMeta(s);
    await s.put(router, { username: "admin", password: "mia" });
    rilascia();
    await giro;
    finto.scriviDaFuori(router, { username: "admin", password: "di-un-altro" });
    await s.aggiorna();
    assert.deepEqual(s.leggiSync(router), { username: "admin", password: "di-un-altro" });
  });
});

describe("errori di DA-Link → ErroreVault, senza corpo e senza gettone", () => {
  it("401: configurazione, «gettone di DA-Link rifiutato»", async () => {
    const s = store({ gettone: "dlv_" + "x".repeat(43) });
    const e = await erroreDi(s.aggiorna());
    assert.equal(e.codice, "configurazione");
    assert.match(e.message, /gettone di DA-Link rifiutato/);
    assert.ok(!e.message.includes("dlv_") && !e.message.includes(MARCA_CORPO));
    const st = s.stato();
    assert.ok(!st.pronto && /gettone di DA-Link rifiutato/.test(st.motivo));
  });

  it("caso 4 — impronta sbagliata: configurazione «certificato di DA-Link cambiato», al server non arriva niente", async () => {
    const altro = normalizzaImpronta(certificatoDiProva("altro").impronta) ?? "";
    const s = store({ impronta: altro });
    const e = await erroreDi(s.aggiorna());
    assert.equal(e.codice, "configurazione");
    assert.match(e.message, /certificato di DA-Link cambiato/i);
    assert.equal(await codiceDi(s.get("app/da-ipam/encryption", { perConto: "mario.rossi" })), "configurazione");
    assert.equal(await codiceDi(s.put("app/da-ipam/x", { a: "b" })), "configurazione");
    assert.equal(finto.richieste.length, 0, "il gettone è partito verso un certificato diverso");
  });

  it("400 → percorso_non_valido; 413 e 422 → rifiutato; 500 e 503 → non_raggiungibile; 404 → non_trovato", async () => {
    const s = store();
    const casi: Array<[number, string]> = [
      [400, "percorso_non_valido"],
      [404, "non_trovato"],
      [413, "rifiutato"],
      [422, "rifiutato"],
      [500, "non_raggiungibile"],
      [503, "non_raggiungibile"],
      [418, "rifiutato"],
    ];
    for (const [status, codice] of casi) {
      finto.forza = () => ({ status, body: JSON.stringify({ detail: `testo ${MARCA_CORPO}` }) });
      const e = await erroreDi(s.get("app/da-ipam/encryption", { perConto: "mario.rossi" }));
      assert.equal(e.codice, codice, `HTTP ${status}`);
      assert.ok(!e.message.includes(MARCA_CORPO), `HTTP ${status}: il corpo è finito nel messaggio`);
      const ep = await erroreDi(s.put("app/da-ipam/encryption", { chiave: "x" }));
      assert.ok(!ep.message.includes(MARCA_CORPO), `PUT HTTP ${status}: il corpo è finito nel messaggio`);
    }
  });

  it("DA-Link che non risponde in tempo: non_raggiungibile", async () => {
    const muto = createTcpServer(() => {
      /* accetta e tace */
    });
    await new Promise<void>((ok) => muto.listen(0, "127.0.0.1", ok));
    const { port } = muto.address() as AddressInfo;
    try {
      const s = store({ url: `https://127.0.0.1:${port}`, timeoutMs: 300 });
      assert.equal(await codiceDi(s.aggiorna()), "non_raggiungibile");
    } finally {
      muto.close();
    }
  });
});

describe("il gettone e i valori non escono", () => {
  it("mai in stato(), in nessuno stato", async () => {
    const s = store();
    const stati: unknown[] = [s.stato()];
    await s.aggiorna();
    stati.push(s.stato());
    finto.giu = true;
    await s.aggiorna().catch(() => undefined);
    stati.push(s.stato());
    adesso += 25 * ORA;
    stati.push(s.stato());
    const rifiutato = store({ gettone: "dlv_" + "z".repeat(43) });
    finto.giu = false;
    await rifiutato.aggiorna().catch(() => undefined);
    stati.push(rifiutato.stato());
    const testo = JSON.stringify(stati);
    for (const segreto of [finto.gettone, "dlv_", PASSWORD, COMMUNITY, "chiave-di-prova", MARCA_CORPO]) {
      assert.ok(!testo.includes(segreto), `in stato() c'è ${segreto.slice(0, 6)}…`);
    }
  });

  it("mai nel log, negli errori o nei giri falliti", async () => {
    const s = store({ aggiornaOgniMs: 50 });
    const testo = await console_(async () => {
      const ferma = s.avvia();
      await dopoIlGiro();
      await s.get("clienti/70001/da-ipam/router-1", { perConto: "mario.rossi" });
      finto.scriviDaFuori("clienti/70001/da-ipam/router-1", { password: PASSWORD });
      await s.put("clienti/70001/da-ipam/router-1", { password: "x" }).catch((e: unknown) => console.error("scrittura fallita", e));
      finto.giu = true;
      await dopoIlGiro();
      adesso += 25 * ORA;
      await s.aggiorna().catch((e: unknown) => console.error("aggiornamento fallito", e));
      await s.get("app/da-ipam/encryption").catch((e: unknown) => console.error("lettura fallita", e));
      ferma();
      const sbagliato = store({ gettone: "dlv_" + "q".repeat(43) });
      finto.giu = false;
      await sbagliato.aggiorna().catch((e: unknown) => console.error("gettone", e));
    });
    assert.match(testo, /giro della cache non riuscito/, "la premessa: il log dei giri falliti è stato catturato");
    for (const segreto of [finto.gettone, "dlv_", PASSWORD, COMMUNITY, "chiave-di-prova", "tok-librenms-55", MARCA_CORPO]) {
      assert.ok(!testo.includes(segreto), `nei log c'è ${segreto.slice(0, 6)}…`);
    }
  });
});
