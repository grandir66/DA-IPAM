/**
 * Reti viste e oggetti con nome (2026-11-23): gli indirizzi fuori dal censimento per rete, il nome dato da
 * una persona al posto di «Rete non censita», senza toccare la tabella delle subnet.
 *
 * Run: node --import tsx --test src/lib/traffico/__tests__/oggetti.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { dbTraffico } from "@/lib/traffico/lettura";
import { insiemeTraffico } from "@/lib/traffico/insieme";
import { calcolaRetiViste, creaCercatore, elencoOggetti, normalizzaChiave, privato, retiViste, salvaOggetto, togliOggetto } from "@/lib/traffico/oggetti";

const T = "TRAFFOGG2311";
after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

test("regole pure: chiavi, privati, la rete più stretta, raggruppamento per /24 o per oggetto", () => {
  assert.equal(normalizzaChiave("10.9.8.7/24"), "10.9.8.0/24");
  assert.equal(normalizzaChiave(" 10.9.8.7 "), "10.9.8.7/32");
  for (const storta of ["10.9.8.7/7", "10.9.8.7/33", "10.9.8/24", "fe80::1/64", "10.9.8.7/24/1", "esterno"]) assert.equal(normalizzaChiave(storta), null, storta);
  assert.ok(privato("172.31.255.1") && privato("100.64.0.1") && !privato("172.32.0.1") && !privato("8.8.8.8"));
  const cerca = creaCercatore(["10.9.0.0/16", "10.9.8.0/24"]);
  assert.deepEqual([cerca("10.9.8.7"), cerca("10.9.1.1"), cerca("10.8.0.1"), cerca("fe80::1")], ["10.9.8.0/24", "10.9.0.0/16", null, null]);

  const c = (client: string, server: string, byte: number, ultima = "2026-11-23 10:00:00") => ({ client, server, byte, prima_vista: "2026-11-22 09:00:00", ultima_vista: ultima });
  const coppie = [
    c("10.9.8.7", "10.4.0.5", 100), c("10.9.8.9", "esterno", 50, "2026-11-23 11:00:00"), c("10.4.0.5", "10.9.8.7", 10),
    c("10.9.8.7", "10.9.8.9", 5),   // dentro la stessa rete vista: una volta sola
    c("10.50.1.1", "10.50.2.2", 7), // due /24 che un oggetto /16 tiene insieme
    c("10.4.0.5", "10.4.0.6", 999), // tutto censito: non c'entra
  ];
  const censita = (ip: string) => ip.startsWith("10.4.");
  const viste = calcolaRetiViste(coppie, censita, [{ chiave: "10.50.0.0/16", nome: "Sede di Brescia", nota: "" }], (ip) => (ip === "esterno" ? "esterno" : censita(ip) ? "4" : "nessuna"));
  assert.deepEqual(viste.map((v) => [v.chiave, v.nome, v.host, v.byte]), [["10.9.8.0/24", null, 2, 165], ["10.50.0.0/16", "Sede di Brescia", 2, 7]]);
  assert.deepEqual(viste[0].con, [{ rete: "4", byte: 110 }, { rete: "esterno", byte: 50 }, { rete: "o:10.9.8.0/24", byte: 5 }]);
  assert.equal(viste[0].ultima_vista, "2026-11-23 11:00:00");
});

test("dare un nome: non crea subnet né host, il nome compare «fra reti», una rete censita si rifiuta", async () => {
  await withTenant(T, async () => {
    const d = dbTraffico();
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.4.0.0/24', 'Uffici')").run().lastInsertRowid);
    const oggi = new Date().toISOString().slice(0, 10);
    const ins = d.prepare("INSERT INTO traffico_coppie (giorno, collector_id, fonte, client, server, proto, porta, byte, pacchetti, flussi, esterni, prima_vista, ultima_vista) VALUES (?, ?, 'mirror', ?, ?, 6, 443, ?, 1, 1, 0, ?, ?)");
    // due collector vedono la stessa coppia: 300, non 500
    ins.run(oggi, 1, "10.9.8.7", "10.4.0.5", 300, `${oggi} 08:00:00`, `${oggi} 09:00:00`);
    ins.run(oggi, 2, "10.9.8.7", "10.4.0.5", 200, `${oggi} 08:00:00`, `${oggi} 09:00:00`);
    const prima = retiViste(1);
    assert.deepEqual(prima.reti.map((r) => [r.chiave, r.nome, r.host, r.byte, r.con[0].rete]), [["10.9.8.0/24", null, 1, 300, String(rete)]]);
    assert.equal(insiemeTraffico({ vista: "reti", giorni: 1 }).reti[0].da, "nessuna");

    assert.deepEqual(salvaOggetto({ chiave: "10.4.0.0/24", nome: "x", chi: "riccardo" }), { ok: false, motivo: "censita" });
    assert.deepEqual(salvaOggetto({ chiave: "10.9.8.0/24", nome: "  ", chi: "riccardo" }), { ok: false, motivo: "nome" });
    const esito = salvaOggetto({ chiave: "10.9.8.77/24", nome: "Rete del fornitore", nota: "VPN del manutentore", chi: "riccardo" });
    assert.ok(esito.ok && esito.oggetto.chiave === "10.9.8.0/24" && esito.oggetto.ambito === "interno" && esito.oggetto.creato_da === "riccardo");
    // non è una subnet e non crea host
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM networks").get() as { n: number }).n, 1);
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM hosts").get() as { n: number }).n, 0);

    const dopo = insiemeTraffico({ vista: "reti", giorni: 1 });
    assert.equal(dopo.reti[0].da, "o:10.9.8.0/24");
    assert.deepEqual(dopo.reti_censite.find((r) => r.chiave === "o:10.9.8.0/24"), { chiave: "o:10.9.8.0/24", nome: "Rete del fornitore", cidr: "10.9.8.0/24", oggetto: true });
    assert.equal(insiemeTraffico({ vista: "coppie", giorni: 1, rete: "o:10.9.8.0/24" }).totale, 1);
    assert.equal(retiViste(1).reti[0].nome, "Rete del fornitore");
    // cambiare nome è la stessa riga; toglierlo riporta a «non censita»
    salvaOggetto({ chiave: "10.9.8.0/24", nome: "Fornitore caldaie", chi: "riccardo" });
    assert.deepEqual(elencoOggetti().map((o) => o.nome), ["Fornitore caldaie"]);
    assert.ok(togliOggetto("10.9.8.0/24"));
    assert.equal(insiemeTraffico({ vista: "reti", giorni: 1 }).reti[0].da, "nessuna");
  });
});
