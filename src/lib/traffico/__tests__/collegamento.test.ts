/**
 * Collegamento guidato con DA-GEO (25/11/2026): il segreto e il codice non arrivano al browser, il codice si salva
 * appena ritirato, DA-GEO muto lascia in attesa, due schede insieme ritirano una volta sola. `fetch` è finta.
 *
 * Run: node --import tsx --test src/lib/traffico/__tests__/collegamento.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { dbTraffico } from "@/lib/traffico/lettura";
import { statoListe, togliFonte } from "@/lib/traffico/liste";
import { annullaRichiesta, apriRichiesta, controllaRichiesta, richiestaAperta } from "@/lib/traffico/collegamento";

const T = "70791";
const URL_GEO = "https://survey.domarc.it/geo";
const SEGRETO = "ab".repeat(32);
const CODICE = "0123456789abcdef0123456789abcdef";
const vera = globalThis.fetch;
after(() => { globalThis.fetch = vera; closeTenantDb(T); deleteTenantDatabase(T); closeHubDb(); });

let esito: () => Response | Promise<Response> = () => Response.json({ stato: "attesa" });
let liste: () => Response = () => Response.json({ formato: 1, liste: [] });
const chiamate: { url: string; corpo: string }[] = [];
globalThis.fetch = (async (u: string | URL, i?: RequestInit) => {
  chiamate.push({ url: String(u), corpo: String(i?.body ?? "") });
  if (String(u) === `${URL_GEO}/collega`) return Response.json({ numero: "7KQ4-M2XB", segreto: SEGRETO, minuti: 15 });
  if (String(u) === `${URL_GEO}/collega/esito`) return esito();
  return liste();
}) as typeof fetch;
const confermata = () => Response.json({ stato: "confermata", codice: CODICE, dispositivo: "IPAM x", cliente: "70791", nome_cliente: "Domarc Srl" });

beforeEach(() => withTenant(T, () => { annullaRichiesta(); togliFonte(); chiamate.length = 0; esito = () => Response.json({ stato: "attesa" }); liste = () => Response.json({ formato: 1, liste: [] }); }));

test("giro intero: il numero si mostra, segreto e codice no", async () => {
  await withTenant(T, async () => {
    const r = await apriRichiesta(URL_GEO);
    assert.equal(chiamate[0].corpo, '{"cliente":"70791"}');
    assert.deepEqual([r.numero, r.apri], ["7KQ4-M2XB", `${URL_GEO}/admin/collega?numero=7KQ4-M2XB`]);
    assert.deepEqual(richiestaAperta(), r);
    const attesa = await controllaRichiesta();
    assert.equal(attesa.stato, "attesa");
    esito = confermata;
    const fatto = await controllaRichiesta();
    assert.equal(fatto.stato, "collegato");
    assert.ok(![r, attesa, fatto].some((x) => JSON.stringify(x).includes(SEGRETO) || JSON.stringify(x).includes(CODICE)));
    assert.deepEqual([statoListe().configurato, statoListe().cliente, richiestaAperta()], [true, "Domarc Srl", null]);
    const d = dbTraffico();
    assert.ok(!JSON.stringify([d.prepare("SELECT * FROM traffico_liste_fonte").all(), d.prepare("SELECT * FROM traffico_liste_richiesta").all()]).includes(CODICE));
    assert.equal((await controllaRichiesta()).stato, "nessuna");
  });
  assert.ok(chiamate.every((c) => !c.url.includes(SEGRETO)));
});

test("il segreto salvato è cifrato", async () => {
  await withTenant(T, async () => {
    await apriRichiesta(URL_GEO);
    assert.ok(!JSON.stringify(dbTraffico().prepare("SELECT * FROM traffico_liste_richiesta").all()).includes(SEGRETO));
  });
});

test("DA-GEO muto o rotto: resta in attesa; poi riprende", async () => {
  await withTenant(T, async () => {
    await apriRichiesta(URL_GEO);
    for (const rotto of [() => { throw new TypeError("rete"); }, () => new Response("no", { status: 502 }), () => new Response("<html>")]) {
      esito = rotto;
      assert.equal((await controllaRichiesta()).stato, "attesa");
      assert.ok(richiestaAperta());
    }
    esito = confermata;
    assert.equal((await controllaRichiesta()).stato, "collegato");
  });
});

test("il codice ritirato si salva anche se le liste non arrivano", async () => {
  await withTenant(T, async () => {
    await apriRichiesta(URL_GEO);
    esito = confermata;
    liste = () => new Response("no", { status: 503 });
    const e = await controllaRichiesta();
    assert.equal(e.stato, "collegato");
    assert.ok(statoListe().configurato && statoListe().errore);
  });
});

test("due schede insieme ritirano una volta sola", async () => {
  await withTenant(T, async () => {
    await apriRichiesta(URL_GEO);
    let volte = 0;
    esito = () => (++volte === 1 ? confermata() : Response.json({ stato: "scaduta" }));
    const [a, b] = await Promise.all([controllaRichiesta(), controllaRichiesta()]);
    assert.deepEqual([a.stato, b.stato, volte], ["collegato", "collegato", 1]);
  });
});

test("annullata mentre si aspetta: non si collega", async () => {
  await withTenant(T, async () => {
    await apriRichiesta(URL_GEO);
    esito = async () => { annullaRichiesta(); return confermata(); };
    assert.equal((await controllaRichiesta()).stato, "nessuna");
    assert.equal(statoListe().configurato, false);
  });
});

test("rifiutata, scaduta, codice storto", async () => {
  await withTenant(T, async () => {
    await apriRichiesta(URL_GEO);
    esito = () => Response.json({ stato: "rifiutata" });
    assert.equal((await controllaRichiesta()).stato, "rifiutata");
    await apriRichiesta(URL_GEO);
    esito = () => Response.json({ stato: "confermata", codice: "../../admin" });
    assert.equal((await controllaRichiesta()).stato, "scaduta");
    assert.equal(statoListe().configurato, false);
    await apriRichiesta(URL_GEO);
    const dopo = new Date(Date.now() + 16 * 60_000);
    assert.equal(richiestaAperta(dopo), null);
    esito = confermata;
    assert.equal((await controllaRichiesta(dopo)).stato, "scaduta");
  });
});
