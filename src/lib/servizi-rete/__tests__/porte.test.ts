import { test } from "node:test";
import assert from "node:assert/strict";
import { portePerGiro, porteTcpPiuFrequenti, porteUdpPiuFrequenti, PORTE_COMUNI } from "../porte";

const NMAP = "# commento\nhttp\t80/tcp\t0.484143\nssh\t22/tcp\t0.182286\nfoo\t53/udp\t0.9\njetdirect\t9100/tcp\t0.008\nbar\t4444/tcp\t0.000100\nzero\t5/tcp\t0.000000\n";

test("classifica di nmap-services: solo TCP, per frequenza, niente frequenza zero", () => {
  assert.deepEqual(porteTcpPiuFrequenti(NMAP, 3), [80, 22, 9100]);
  assert.deepEqual(porteTcpPiuFrequenti(NMAP, 10), [80, 22, 9100, 4444]);
});

test("classifica UDP: solo udp, per frequenza", () => {
  assert.deepEqual(porteUdpPiuFrequenti(NMAP, 5), [53]);
});

test("elenco del giro: unione, senza stampa né campo, ripiego senza file", () => {
  const con = portePerGiro(10, () => NMAP);
  assert.ok(con.includes(4444), "porta fuori standard dalla classifica");
  assert.ok(con.includes(8291), "Winbox di MikroTik dalle porte di gestione");
  assert.ok(!con.includes(9100), "la 9100 non si prova mai");
  const senza = portePerGiro(10, () => null);
  assert.ok(PORTE_COMUNI.every((p) => senza.includes(p)));
  assert.ok(!senza.includes(4444));
});
