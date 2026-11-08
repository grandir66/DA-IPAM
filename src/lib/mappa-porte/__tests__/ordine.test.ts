// Ordinamento delle tabelle della Mappa porte (Riccardo, 08/11: «le colonne sono fisse e non è possibile ordinarle come in tutti
// gli altri moduli»). Sul SQLite vero: IP come numero, NULL in fondo in tutti e due i versi, colonna sconosciuta = ordine di sempre.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ipSql, ordinePer } from "@/lib/mappa-porte/calcolo";

const db = new Database(":memory:");
db.exec("CREATE TABLE t (k TEXT, ip TEXT, n INTEGER)");
for (const [k, ip, n] of [["a", "10.0.0.10", 3], ["b", "10.0.0.9", null], ["c", null, 1], ["d", "192.168.1.1", 2], ["e", "2.0.0.1", 5]] as const) db.prepare("INSERT INTO t VALUES (?, ?, ?)").run(k, ip, n);
const COLONNE = { ip: [ipSql("ip")], n: ["n"] };
const chiavi = (o: Parameters<typeof ordinePer>[1]) => (db.prepare(`SELECT k FROM t ORDER BY ${ordinePer(COLONNE, o, ["k"], ["k"])}`).all() as Array<{ k: string }>).map((r) => r.k).join("");

test("IP in ordine numerico, il NULL in fondo anche al contrario", () => {
  assert.equal(chiavi({ colonna: "ip", verso: "asc" }), "ebadc");
  assert.equal(chiavi({ colonna: "ip", verso: "desc" }), "dabec");
});

test("numeri col verso scelto, NULL in fondo; colonna sconosciuta o assente = ordine di sempre, mai testo nella query", () => {
  assert.equal(chiavi({ colonna: "n", verso: "desc" }), "eadcb");
  assert.equal(chiavi({ colonna: "k; DROP TABLE t", verso: "asc" }), "abcde");
  assert.equal(chiavi(undefined), "abcde");
});
