/**
 * Correzioni della revisione del 23/10 al backend `openbao`:
 *
 * 4. Un `credential_ref` malformato in UNA voce non deve far fallire il giro della cache di tutte: la voce si salta con
 *    un avviso (cliente + voce, senza valori, una volta sola) e si vede nello stato.
 * 11. `X-Domarc-Utente` con caratteri non ASCII: percent-encoding (un header con «Ł» faceva lanciare fetch, che
 *     diventava un finto «OpenBao non risponde»), più l'id dell'utente.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/openbao-correzioni.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { OpenBaoStore } from "../openbao";
import { ErroreVault } from "../tipi";
import { creaOpenBaoFinto, type OpenBaoFinto } from "./support/openbao-finto";

const MIN = 60_000;
const PASSWORD = "Pw-di-prova-correzioni-9d2f";
let adesso = Date.parse("2026-10-23T08:00:00Z");
let finto: OpenBaoFinto;

function store(extra: Partial<ConstructorParameters<typeof OpenBaoStore>[0]> = {}): OpenBaoStore {
  return new OpenBaoStore({
    url: finto.url,
    roleId: finto.roleId,
    secretId: () => finto.secretId,
    cartelle: ["app/da-ipam"],
    aggiornaOgniMs: 5 * MIN,
    durataCacheMs: 30 * MIN,
    fetch: finto.fetch,
    ora: () => adesso,
    ...extra,
  });
}

function avvisi(): { righe: string[]; ripristina: () => void } {
  const righe: string[] = [];
  const orig = { warn: console.warn, error: console.error, info: console.info, log: console.log };
  for (const k of Object.keys(orig) as Array<keyof typeof orig>) console[k] = (...a: unknown[]) => { righe.push(a.map(String).join(" ")); };
  return { righe, ripristina: () => Object.assign(console, orig) };
}

beforeEach(() => {
  adesso = Date.parse("2026-10-23T08:00:00Z");
  finto = creaOpenBaoFinto({ ora: () => adesso });
  finto.kv.set("clienti/c1/firewall/ssh", { username: "admin", password: PASSWORD });
  finto.kv.set("clienti/c2/firewall/ssh", { username: "root", password: "altra-pw" });
});

describe("rilievo 4: un riferimento malformato non ferma la cache", () => {
  const extra = () => [
    { percorso: "clienti/c1/firewall/ssh", origine: "C1#7" },
    { percorso: "CLIENTI/Maiuscolo//storto", origine: "C1#8" },
    { percorso: "../fuori", origine: "C2#3" },
    { percorso: "clienti/c2/firewall/ssh", origine: "C2#4" },
  ];

  it("il giro riesce: le voci valide entrano nella cache, quelle malformate sono saltate", async () => {
    const s = store({ percorsiExtra: extra });
    await s.aggiorna();
    assert.equal(s.leggiSync("clienti/c1/firewall/ssh").password, PASSWORD);
    assert.equal(s.leggiSync("clienti/c2/firewall/ssh").username, "root");
    assert.equal(s.stato().pronto, true);
  });

  it("lo stato dice quante voci sono state saltate (senza nomi)", async () => {
    const s = store({ percorsiExtra: extra });
    await s.aggiorna();
    const st = s.stato();
    assert.ok(st.pronto);
    assert.equal(st.pronto && st.riferimentiSaltati, 2);
    assert.match(st.pronto ? (st.degradato ?? "") : "", /2 riferimenti/);
    assert.doesNotMatch(JSON.stringify(st), /C1#8|Maiuscolo|fuori/);
  });

  it("l'avviso nomina cliente e voce, non i valori, e non si ripete a ogni giro", async () => {
    const s = store({ percorsiExtra: extra });
    const a = avvisi();
    try {
      await s.aggiorna();
      await s.aggiorna();
    } finally {
      a.ripristina();
    }
    const testo = a.righe.join("\n");
    assert.match(testo, /C1#8/);
    assert.match(testo, /C2#3/);
    assert.equal(a.righe.filter((r) => r.includes("C1#8")).length, 1, "avviso ripetuto a ogni giro");
    assert.ok(!testo.includes(PASSWORD));
  });

  it("senza riferimenti malformati lo stato non cambia (nessun campo in più rumoroso)", async () => {
    const s = store({ percorsiExtra: () => ["clienti/c1/firewall/ssh"] });
    await s.aggiorna();
    const st = s.stato();
    assert.ok(st.pronto);
    assert.ok(!st.pronto || (st.riferimentiSaltati ?? 0) === 0);
    assert.equal(st.pronto ? st.degradato : undefined, undefined);
  });

  it("la lettura di quella voce malformata resta un rifiuto dichiarato (percorso_non_valido)", async () => {
    const s = store({ percorsiExtra: extra });
    await s.aggiorna();
    assert.throws(() => s.leggiSync("CLIENTI/Maiuscolo//storto"), (e: unknown) => e instanceof ErroreVault && e.codice === "percorso_non_valido");
  });
});

describe("rilievo 11: X-Domarc-Utente non ASCII", () => {
  it("un nome con caratteri fuori da latin1 arriva percent-encoded, con l'id", async () => {
    const s = store();
    await s.aggiorna();
    const v = await s.get("clienti/c1/firewall/ssh", { perConto: "Łukasz Żółć", perContoId: "12" });
    assert.equal(v.password, PASSWORD);
    const r = finto.richieste.filter((x) => x.utente !== null);
    assert.equal(r.length, 1);
    assert.equal(r[0].utente, `${encodeURIComponent("Łukasz Żółć")};id=12`);
    assert.match(r[0].utente ?? "", /^[\x20-\x7e]+$/, "l'intestazione deve essere ASCII");
  });

  it("un nome con accenti latin1 (è, à) arriva ASCII, non in byte latin1", async () => {
    const s = store();
    await s.aggiorna();
    await s.get("clienti/c1/firewall/ssh", { perConto: "Niccolò Rossi", perContoId: "5" });
    const u = finto.richieste.find((x) => x.utente !== null)?.utente ?? "";
    assert.equal(u, "Niccol%C3%B2%20Rossi;id=5");
  });

  it("un nome ASCII semplice resta com'era; l'id vuoto o strano è rifiutato", async () => {
    const s = store();
    await s.aggiorna();
    await s.get("clienti/c1/firewall/ssh", { perConto: "mario.rossi" });
    assert.equal(finto.richieste.find((x) => x.utente !== null)?.utente, "mario.rossi");
    await assert.rejects(s.get("clienti/c1/firewall/ssh", { perConto: "mario", perContoId: "1;x=2\r\nX-Altro: 1" }), (e: unknown) => e instanceof ErroreVault && e.codice === "configurazione");
  });

  it("a capo e caratteri di controllo nel nome restano rifiutati", async () => {
    const s = store();
    await s.aggiorna();
    await assert.rejects(s.get("clienti/c1/firewall/ssh", { perConto: "mario\r\nX-Altro: 1" }), (e: unknown) => e instanceof ErroreVault && e.codice === "configurazione");
  });
});
