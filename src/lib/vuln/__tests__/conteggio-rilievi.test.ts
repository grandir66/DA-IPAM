process.env.ENCRYPTION_KEY ||= "test-encryption-key-conteggio-rilievi";

/**
 * `riallineaConteggioRilievi` (04/11/2026). La sonda dichiara per uno scan un
 * `finding_count` che conta **solo i rilievi Greenbone**: misurato sull'hub,
 * il giro 124 dichiarava 1832 e ne aveva 2402 (Greenbone 1832, controlli 530,
 * Nuclei 40), e lo stesso sui giri 121-123.
 *
 * Run: node --import tsx --test src/lib/vuln/__tests__/conteggio-rilievi.test.ts
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { riallineaConteggioRilievi } from "@/lib/vuln/conteggio-rilievi";

const T = "TESTCONTEGGIORILIEVI";
after(() => deleteTenantDatabase(T));
const oggi = new Date().toISOString().slice(0, 19).replace("T", " ");

test("riallinea al totale vero, lascia stare i giri senza rilievi scaricati, è idempotente", () =>
  withTenant(T, () => {
    const d = getTenantDb(T);
    const sc = Number(
      d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('E', 'https://x', 'x')").run().lastInsertRowid
    );
    const altroSc = Number(
      d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('E2', 'https://y', 'y')").run().lastInsertRowid
    );
    const giro = (scanner: number, edgeId: number, dichiarato: number) =>
      Number(
        d.prepare("INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, status, finding_count) VALUES (?, ?, 'done', ?)")
          .run(scanner, edgeId, dichiarato).lastInsertRowid
      );
    const rilievo = d.prepare("INSERT INTO vuln_findings (scan_run_id, ip, severity, nvt_oid, nvt_name, scanned_at) VALUES (?, '10.0.0.1', 'Log', ?, 'x', ?)");
    const conta = (id: number) => (d.prepare("SELECT finding_count AS c FROM vuln_scan_runs WHERE id = ?").get(id) as { c: number }).c;

    // Il caso vero in piccolo: 3 Greenbone dichiarati, in archivio anche 2 controlli e 1 nuclei.
    const misto = giro(sc, 1, 3);
    for (const oid of ["1.3.6.1.1", "1.3.6.1.2", "1.3.6.1.3", "controllo:tls-deep:a", "controllo:tls-deep:b", "nuclei:qualcosa"]) {
      rilievo.run(misto, oid, oggi);
    }
    // Giro appena inserito, rilievi non ancora scaricati: il numero della sonda resta.
    const senzaRilievi = giro(sc, 2, 77);
    // Giro di un altro scanner: non deve essere toccato dal filtro per scanner.
    const altro = giro(altroSc, 3, 5);
    rilievo.run(altro, "1.3.6.1.9", oggi);

    const corretti = riallineaConteggioRilievi(d, sc);
    assert.equal(corretti, 1, "doveva correggere solo il giro misto");
    assert.equal(conta(misto), 6, "il totale deve comprendere controlli e nuclei");
    assert.equal(conta(senzaRilievi), 77, "un giro senza rilievi scaricati non si azzera");
    assert.equal(conta(altro), 5, "un altro scanner non si tocca");

    // Idempotente: una seconda passata non cambia niente.
    assert.equal(riallineaConteggioRilievi(d, sc), 0);
    assert.equal(conta(misto), 6);

    // Senza scanner riallinea tutto, quindi ora tocca anche l'altro.
    assert.equal(riallineaConteggioRilievi(d), 1);
    assert.equal(conta(altro), 1);
  }));

test("un conteggio già giusto non viene riscritto", () =>
  withTenant(T, () => {
    const d = getTenantDb(T);
    const sc = Number(
      d.prepare("INSERT INTO vuln_scanners (name, base_url, token_encrypted) VALUES ('E3', 'https://z', 'z')").run().lastInsertRowid
    );
    const run = Number(
      d.prepare("INSERT INTO vuln_scan_runs (scanner_id, edge_scan_id, status, finding_count) VALUES (?, 90, 'done', 1)").run(sc).lastInsertRowid
    );
    d.prepare("INSERT INTO vuln_findings (scan_run_id, ip, severity, nvt_oid, nvt_name, scanned_at) VALUES (?, '10.0.0.2', 'Log', '1.3.6.1', 'x', ?)").run(run, oggi);
    assert.equal(riallineaConteggioRilievi(d, sc), 0);
  }));
