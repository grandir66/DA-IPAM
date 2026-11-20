import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calcolaInsieme, type RigaCoppia } from "../insieme";

const riga = (client: string, server: string, porta: number, byte: number): RigaCoppia =>
  ({ client, server, proto: 6, porta, byte, ultima_vista: "2026-11-20 10:00:00" });
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
    assert.deepEqual(e.tessere, { host: 3, coppie: 4, byte: 2050, byte_esterno: 400 });
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
