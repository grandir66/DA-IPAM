import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calcolaAndamento, calcolaInsieme, inizioOra, type RigaCoppia } from "../insieme";

const riga = (client: string, server: string, porta: number, byte: number): RigaCoppia =>
  ({ client, server, proto: 6, porta, byte, pacchetti: 2, flussi: 1, esterni: server === "esterno" ? 7 : 0, ultima_vista: "2026-11-20 10:00:00" });
const RIGHE = [
  riga("10.4.0.10", "10.20.0.5", 443, 1000),
  riga("10.4.0.11", "10.20.0.5", 443, 500),
  riga("10.4.0.10", "10.20.0.5", 22, 100),
  riga("10.4.0.10", "esterno", 443, 400),
  riga("10.20.0.5", "10.4.0.10", 445, 50),
];
const reteDi = (ip: string): string => (ip === "esterno" ? "esterno" : ip.startsWith("10.4.") ? "4" : "20");
const nomeDi = (ip: string): string | null => (ip === "10.20.0.5" ? "srv-file" : null);

describe("traffico sulla rete intera", () => {
  it("fra reti: una riga per verso, host e coppie contati una volta, servizi per volume", () => {
    const e = calcolaInsieme(RIGHE, reteDi, nomeDi, { vista: "reti" });
    assert.deepEqual(e.tessere, { host: 3, coppie: 4, byte: 2050, byte_esterno: 400, pacchetti: 10, flussi: 5 });
    assert.deepEqual(e.reti.map((r) => [r.da, r.a, r.host, r.coppie, r.byte]), [["4", "20", 3, 2, 1600], ["4", "esterno", 1, 1, 400], ["20", "4", 2, 1, 50]]);
    assert.deepEqual(e.reti[0].servizi.map((s) => s.porta), [443, 22]);
  });
  it("per host: chi contatta e da chi è contattato; i servizi sono quelli che offre", () => {
    const e = calcolaInsieme(RIGHE, reteDi, nomeDi, { vista: "host" });
    const srv = e.host.find((h) => h.ip === "10.20.0.5")!;
    assert.deepEqual([srv.contatta, srv.contattato_da, srv.byte_client, srv.byte_server], [1, 2, 50, 1600]);
    assert.deepEqual(srv.servizi.map((s) => s.porta), [443, 22]);
    assert.ok(!e.host.some((h) => h.ip === "esterno"));
  });
  it("i filtri: rete da una parte o dall'altra, il verso di una riga, un nome, una porta", () => {
    assert.equal(calcolaInsieme(RIGHE, reteDi, nomeDi, { vista: "coppie", rete: "esterno" }).totale, 1);
    assert.equal(calcolaInsieme(RIGHE, reteDi, nomeDi, { vista: "coppie", da: "20", a: "4" }).coppie[0].porta, 445);
    assert.equal(calcolaInsieme(RIGHE, reteDi, nomeDi, { vista: "coppie", cerca: "SRV-FILE" }).totale, 4);
    assert.equal(calcolaInsieme(RIGHE, reteDi, nomeDi, { vista: "coppie", cerca: "22" }).totale, 1);
    assert.equal(calcolaInsieme(RIGHE, reteDi, nomeDi, { vista: "coppie", cerca: "10.4.0.11" }).totale, 1);
  });
});

describe("pacchetti, connessioni, esterni, andamento (23/11)", () => {
  it("fra reti e per host portano pacchetti e connessioni; gli esterni di un host sono il conteggio più alto", () => {
    const reti = calcolaInsieme(RIGHE, reteDi, nomeDi, { vista: "reti" });
    assert.deepEqual([reti.reti[0].pacchetti, reti.reti[0].flussi], [6, 3]);
    const h = calcolaInsieme(RIGHE, reteDi, nomeDi, { vista: "host" }).host.find((x) => x.ip === "10.4.0.10")!;
    assert.deepEqual([h.esterni, h.pacchetti, h.flussi], [7, 8, 4]);
  });
  it("andamento: un punto per ora chiesta, anche vuota; fuori dalle ore e fuori dal filtro non conta", () => {
    const ore = ["2026-11-23 08:00:00", "2026-11-23 09:00:00", "2026-11-23 10:00:00"];
    const r = (ora: string, client: string, server: string, byte: number) => ({ ora, client, server, byte, pacchetti: 1, flussi: 1 });
    const righe = [r(ore[0], "10.4.0.10", "esterno", 100), r(ore[0], "10.4.0.10", "10.20.0.5", 50), r(ore[2], "10.20.0.5", "10.20.0.6", 9), r("2026-11-22 08:00:00", "10.4.0.10", "esterno", 999)];
    assert.deepEqual(calcolaAndamento(righe, ore, () => true).map((p) => [p.byte, p.byte_esterno, p.flussi]), [[150, 100, 2], [0, 0, 0], [9, 0, 1]]);
    assert.deepEqual(calcolaAndamento(righe, ore, (x) => reteDi(x.client) === "4" || reteDi(x.server) === "4").map((p) => p.byte), [150, 0, 0]);
    assert.equal(inizioOra(new Date("2026-11-23T10:59:59Z"), -1), "2026-11-23 09:00:00");
  });
});
