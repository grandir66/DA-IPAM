/**
 * Cosa non va (2026-11-23): chi bussa a vuoto, servizi che rifiutano, servizi lenti; le scansioni delle
 * sonde note restano fuori; i servizi usati contro le porte note.
 *
 * Run: node --import tsx --test src/lib/traffico/__tests__/connessioni.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { creaCollector, dbTraffico, sincronizzaTraffico, type Lettore } from "@/lib/traffico/lettura";
import { calcolaCosaNonVa, confrontaServizi, cosaNonVa, serviziDiHost, type ConnessioneCollector, type RigaConnessione } from "@/lib/traffico/connessioni";

const T = "TRAFFCON2311";
const adesso = new Date().toISOString().slice(0, 19).replace("T", " ");
let seq = 0;
const riga = (client: string, server: string, porta: number, extra: Partial<ConnessioneCollector> = {}): ConnessioneCollector =>
  ({ seq: ++seq, inizio: adesso, client, server, porta, tentate: 1, senza_risposta: 0, rifiutate: 0, ripetute: 0, riuscite: 0, ms_minimo: 0, ms_mediano: 0, ...extra });

function finto(connessioni: ConnessioneCollector[]): Lettore {
  return (async (_c: unknown, percorso: string) => {
    if (percorso === "/v1/stato") return { versione: "t", nome: "t", avviato: "", ultimo_seq: 0, pacchetti_visti: 1, pacchetti_persi: 0, copertura: 1 };
    const u = new URL(percorso, "https://x");
    const dopo = Number(u.searchParams.get("dopo"));
    const righe = u.pathname === "/v1/connessioni" ? connessioni.filter((r) => r.seq > dopo) : [];
    return { righe, ultimo_seq: righe.at(-1)?.seq ?? dopo, altri: false, buco: false };
  }) as Lettore;
}

after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

test("regole pure: le tre liste, e i servizi usati contro le porte note", () => {
  const r = (client: string, server: string, porta: number, e: Partial<RigaConnessione>): RigaConnessione =>
    ({ client, server, porta, tentate: 0, senza_risposta: 0, rifiutate: 0, ripetute: 0, riuscite: 0, ms_minimo: 0, ms_mediano: 0, ultima_vista: "2026-11-23 10:00:00", ...e });
  const v = calcolaCosaNonVa([
    r("10.4.0.10", "10.4.0.20", 8080, { tentate: 9, senza_risposta: 9 }),
    r("10.4.0.11", "10.4.0.20", 8080, { tentate: 2, rifiutate: 2 }),
    r("10.4.0.10", "esterno", 25, { tentate: 4, senza_risposta: 4 }),
    r("10.4.0.12", "10.4.0.20", 443, { tentate: 3, ripetute: 3 }),            // ripetuta e poi riuscita: non è un fallimento
    r("", "10.4.0.20", 443, { riuscite: 40, ms_minimo: 2, ms_mediano: 350 }),  // lento
    r("", "10.4.0.21", 22, { riuscite: 3, ms_mediano: 900 }),                  // troppo poche per dirlo
    r("", "esterno", 443, { riuscite: 500, ms_mediano: 800 }),                 // fuori: non è un servizio di casa
  ]);
  assert.deepEqual(v.bussano.map((b) => [b.client, b.destinazioni, b.senza_risposta, b.rifiutate]), [["10.4.0.10", 2, 13, 0], ["10.4.0.11", 1, 0, 2]]);
  assert.deepEqual(v.servizi.map((s) => [s.server, s.porta, s.client, s.senza_risposta, s.rifiutate, s.riuscite]), [["10.4.0.20", 8080, 2, 9, 2, 0]]);
  assert.deepEqual(v.lenti.map((s) => [s.server, s.porta, s.ms_mediano]), [["10.4.0.20", 443, 350]]);

  const c = confrontaServizi(
    [{ proto: 6, porta: 443, byte: 900, client: 5 }, { proto: 6, porta: 5000, byte: 10, client: 1 }, { proto: 1, porta: 0, byte: 1, client: 1 }],
    [{ porta: 443, proto: "tcp", servizio: "https" }, { porta: 22, proto: "tcp", servizio: "ssh" }, { porta: 161, proto: "udp", servizio: "snmp" }], 30);
  assert.deepEqual(c.usate_note.map((p) => [p.porta, p.servizio]), [[443, "https"]]);
  assert.deepEqual(c.usate_non_note.map((p) => p.porta), [5000]);
  assert.deepEqual(c.aperte_mai_usate.map((p) => `${p.proto}/${p.porta}`), ["tcp/22", "udp/161"]);
});

test("dal collector: il servizio spento compare, le scansioni della sonda no; il massimo fra collector; i giorni si sommano", async () => {
  await withTenant(T, async () => {
    const d = dbTraffico();
    creaCollector({ nome: "a", sede: "", url: "https://192.168.99.89:8477", gettone: "g", impronta: "AA" });
    creaCollector({ nome: "b", sede: "", url: "https://192.168.99.90:8477", gettone: "g", impronta: "AA" });
    const sonda = "192.168.4.8";
    const righe = [
      riga("10.4.0.10", "10.4.0.20", 8080, { tentate: 3, senza_risposta: 3 }),             // il servizio spento apposta
      riga("10.4.0.10", "10.4.0.20", 8080, { tentate: 2, senza_risposta: 2 }),             // un'altra finestra dello stesso giorno
      ...Array.from({ length: 30 }, (_, i) => riga(sonda, `10.4.0.${100 + i}`, 22, { rifiutate: 1 })), // le scansioni di IPAM
      riga("", "10.4.0.20", 443, { riuscite: 10, ms_minimo: 3, ms_mediano: 400 }),
      riga("", "10.4.0.20", 443, { riuscite: 30, ms_minimo: 1, ms_mediano: 200 }),
      riga("10.4.0.10", "", 1),                                                               // riga storta
    ];
    assert.equal((await sincronizzaTraffico(finto(righe), undefined, new Set([sonda]))).errori, 0);
    const v = cosaNonVa(1);
    assert.deepEqual(v.bussano.map((b) => [b.client, b.senza_risposta]), [["10.4.0.10", 5]]);
    assert.deepEqual(v.servizi.map((s) => [s.server, s.porta, s.senza_risposta]), [["10.4.0.20", 8080, 5]]);
    // 10 a 400 ms e 30 a 200 ms: 250 di media pesata; il minimo è il più basso
    assert.deepEqual(v.lenti.map((s) => [s.riuscite, s.ms_minimo, s.ms_mediano]), [[40, 1, 250]]);
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM traffico_connessioni WHERE client = ?").get(sonda) as { n: number }).n, 0);

    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.4.0.0/24', 'Uffici')").run().lastInsertRowid);
    d.prepare("INSERT INTO hosts (network_id, ip, open_ports) VALUES (?, '10.4.0.20', ?)").run(rete, JSON.stringify([{ port: 443, protocol: "tcp", service: "https" }, { port: 3389, protocol: "tcp", service: "rdp" }]));
    const oggi = adesso.slice(0, 10);
    const ins = d.prepare("INSERT INTO traffico_coppie (giorno, collector_id, fonte, client, server, proto, porta, byte, pacchetti, flussi, esterni, prima_vista, ultima_vista) VALUES (?, 1, 'mirror', ?, '10.4.0.20', 6, ?, ?, 1, 1, 0, ?, ?)");
    ins.run(oggi, "10.4.0.10", 443, 500, adesso, adesso);
    ins.run(oggi, "10.4.0.11", 443, 100, adesso, adesso);
    ins.run(oggi, "10.4.0.10", 9100, 7, adesso, adesso);
    const s = serviziDiHost("10.4.0.20");
    assert.deepEqual(s.usate_note.map((p) => [p.porta, p.byte, p.client]), [[443, 600, 2]]);
    assert.deepEqual(s.usate_non_note.map((p) => p.porta), [9100]);
    assert.deepEqual(s.aperte_mai_usate.map((p) => p.porta), [3389]);
    // porte scritte male nel database: nessun errore
    d.prepare("UPDATE hosts SET open_ports = '{rotto' WHERE ip = '10.4.0.20'").run();
    assert.equal(serviziDiHost("10.4.0.20").aperte_mai_usate.length, 0);
  });
});
