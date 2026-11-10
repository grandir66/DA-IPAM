/**
 * Incidente 10/11: la scansione nmap -sV sondava la 9100 (jetdirect) e la stampante .84
 * stampava fogli con caratteri strani. Nessun comando nmap deve sondare le porte di stampa raw.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTargetedServiceTcpArgs,
  buildTcpScanArgs,
  ALWAYS_USEFUL_TCP_PORTS,
  PORTE_STAMPA_RAW,
} from "@/lib/scanner/ports";

function porteNelP(cmd: string): number[] {
  const m = /-p\s+([0-9,]+)/.exec(cmd);
  return m ? m[1].split(",").map(Number) : [];
}

test("le porte sempre utili non contengono la 9100", () => {
  assert.ok(!(ALWAYS_USEFUL_TCP_PORTS as readonly number[]).includes(9100));
});

test("scan mirato: niente porte di stampa nel -p, e --exclude-ports presente", () => {
  const cmd = buildTargetedServiceTcpArgs([22, 80, 9100, 515, 443]);
  const p = porteNelP(cmd);
  for (const porta of PORTE_STAMPA_RAW) assert.ok(!p.includes(porta), `la ${porta} non deve stare nel -p`);
  assert.match(cmd, /--exclude-ports\s+[0-9,]*9100/);
});

test("scan completo: niente porte di stampa nel -p, e --exclude-ports presente", () => {
  const cmd = buildTcpScanArgs();
  const p = porteNelP(cmd);
  for (const porta of PORTE_STAMPA_RAW) assert.ok(!p.includes(porta), `la ${porta} non deve stare nel -p`);
  assert.match(cmd, /--exclude-ports\s+[0-9,]*9100/);
});
