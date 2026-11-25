/**
 * `politica.ts` va anche nel browser, quindi non può usare `node:net`: qui si confronta con `net.isIPv6`.
 * Incidente 25/11/2026: con `node:net` la build dell'hub si fermava su «Chi può collegarsi» (v0.9.1357).
 *
 * Run: node --import tsx --test src/lib/protezione/__tests__/ipv6.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import { ipv6Valido, tipoIndirizzo } from "@/lib/protezione/politica";

test("uguale a net.isIPv6, caso per caso", () => {
  const casi = new Set(["", ":", "::", ":::", "::1", "1::", "1:::2", "1::2::3", ":1", "1:", ":1:2:3:4:5:6:7", "1:2:3:4:5:6:7:", "12345::", "g::", "::ffff:1", "fe80::1", "FE80::ABCD"]);
  // ogni numero di gruppi (0-9) con «::» in ogni posizione, semplice e doppio
  for (let n = 0; n <= 9; n++) {
    const g = Array.from({ length: n }, (_, i) => (i + 1).toString(16));
    casi.add(g.join(":"));
    for (let i = 0; i <= n; i++) {
      casi.add(`${g.slice(0, i).join(":")}::${g.slice(i).join(":")}`);
      for (let j = i; j <= n; j++) casi.add(`${g.slice(0, i).join(":")}::${g.slice(i, j).join(":")}::${g.slice(j).join(":")}`);
    }
  }
  // e stringhe a caso dallo stesso alfabeto, con un seme fisso
  let seme = 2511;
  const caso = (m: number) => (seme = (seme * 1103515245 + 12345) & 0x7fffffff) % m;
  for (let i = 0; i < 200_000; i++) {
    let t = "";
    for (let k = caso(39) + 1; k > 0; k--) t += caso(3) === 0 ? ":" : "0123456789abcdefABCDEF"[caso(22)];
    casi.add(t);
  }
  let validi = 0;
  for (const c of casi) {
    if (net.isIPv6(c)) validi++;
    assert.equal(ipv6Valido(c), net.isIPv6(c), c);
  }
  assert.ok(validi > 50, `troppo pochi validi per provare qualcosa: ${validi}`);
});

test("prefissi come prima, e nessun modulo di Node nel file che va nel browser", () => {
  assert.deepEqual(["2001:db8::/32", "::/0", "fe80::1", "2001:db8::/15", "1:2:3:4:5:6:7:8/128", "1::2::3"].map(tipoIndirizzo), ["ipv6", null, "ipv6", null, "ipv6", null]);
  assert.ok(!/from "node:|from "(net|fs|path|child_process)"/.test(readFileSync("src/lib/protezione/politica.ts", "utf8")));
});
