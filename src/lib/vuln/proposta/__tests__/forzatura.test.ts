/**
 * Scansione forzata degli oggetti «da chiarire» (piano profili-per-device, Passo 9, 08/11/2026; tavola 32-34).
 *
 * Perché: Riccardo, sulla LAN Base dell'hub: «con l'autorizzazione di un operatore devono essere scansionabili».
 * Qui: un «da chiarire» forzato entra nel gruppo scelto e negli ammessi di Edge; resta valido finché la proposta lo
 * vede ancora «da chiarire»; se il tipo cambia torna da rivedere ed esce dal lancio; un impianto non si forza;
 * «Togli» lo rimette com'era.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/vuln/proposta/__tests__/forzatura.test.ts
 */
import "@/lib/vuln/__tests__/support/dati-isolati";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { forzaProposta, leggiProposte, rigeneraProposte, togliForzatura } from "@/lib/vuln/proposta/store";
import { ipAmmessiDellaRete } from "@/lib/vuln/proposta/ammessi";
import { gruppiDaConfermate } from "@/lib/vuln/proposta/gruppi";
import { quadroFamiglie } from "@/lib/vuln/proposta/quadro";

const T = "TESTFORZA09";
after(() => { deleteTenantDatabase(T); closeHubDb(); });

function prepara(): { dubbio: number; plc: number } {
  const d = getTenantDb(T);
  d.exec("DELETE FROM va_proposte; DELETE FROM hosts; DELETE FROM networks");
  d.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.90.0.0/24', 'LAN Base')").run();
  const dubbio = Number(d.prepare("INSERT INTO hosts (network_id, ip, status, classification) VALUES (1, '10.90.0.41', 'online', 'unknown')").run().lastInsertRowid);
  const plc = Number(d.prepare("INSERT INTO hosts (network_id, ip, status, classification) VALUES (1, '10.90.0.50', 'online', 'plc')").run().lastInsertRowid);
  rigeneraProposte(1);
  return { dubbio, plc };
}

const riga = (id: number) => leggiProposte(1).find((r) => r.host_id === id)!;
const no = () => false;

test("un «da chiarire» forzato entra nel gruppo scelto, negli ammessi e nel conteggio", () => {
  withTenant(T, () => {
    const { dubbio } = prepara();
    assert.equal(riga(dubbio).famiglia, "da_chiarire");
    // Dall'08/11 sera un «da chiarire» è incluso di serie col profilo prudente; l'impianto no.
    assert.deepEqual(ipAmmessiDellaRete(1), ["10.90.0.41"]);
    assert.deepEqual(forzaProposta(1, { hostId: dubbio, famiglia: "linux", chi: "riccardo", nota: "NAS dell'ufficio" }, no), { ok: true });
    const r = riga(dubbio);
    assert.equal(r.famiglia, "linux");
    assert.equal(r.stato, "confermato");
    assert.equal(r.forzata_da_famiglia, "da_chiarire");
    assert.equal(r.forzata_nota, "NAS dell'ufficio");
    assert.equal(r.confermata_da, "riccardo");
    assert.deepEqual(ipAmmessiDellaRete(1), ["10.90.0.41"]);
    const g = gruppiDaConfermate(leggiProposte(1)).find((x) => x.famiglia === "linux")!;
    assert.deepEqual([g.ips, g.forzati], [["10.90.0.41"], 1]);
    assert.equal(quadroFamiglie(leggiProposte(1)).find((f) => f.famiglia === "linux")!.forzati, 1);
  });
});

test("la rigenerazione non lo tocca finché resta «da chiarire»; se il tipo cambia c'è l'avviso ma resta dentro", () => {
  withTenant(T, () => {
    const { dubbio } = prepara();
    forzaProposta(1, { hostId: dubbio, famiglia: "linux", chi: "r" }, no);
    rigeneraProposte(1);
    assert.equal(riga(dubbio).da_rivedere, 0);
    assert.equal(riga(dubbio).famiglia, "linux");
    getTenantDb(T).prepare("UPDATE hosts SET classification='switch', classification_manual=1 WHERE id=?").run(dubbio);
    // Riccardo, 08/11/2026: la scelta vale fino a modifica manuale; il tipo cambiato è solo un avviso.
    assert.deepEqual(ipAmmessiDellaRete(1), ["10.90.0.41"]);
    rigeneraProposte(1);
    assert.equal(riga(dubbio).da_rivedere, 1);
    assert.deepEqual(ipAmmessiDellaRete(1), ["10.90.0.41"]);
  });
});

test("un impianto non si forza da qui", () => {
  withTenant(T, () => {
    const { dubbio, plc } = prepara();
    const r1 = forzaProposta(1, { hostId: plc, famiglia: "linux", chi: "r" }, no);
    assert.equal(r1.ok, false);
    const r2 = forzaProposta(1, { hostId: dubbio, famiglia: "linux", chi: "r" }, () => true);
    assert.deepEqual(r2, { ok: false, motivo: "è un impianto: si autorizza col consenso, non si forza" });
    assert.equal(riga(dubbio).stato, "proposto");
  });
});

test("«Togli» lo rimette «da chiarire», proposto, di nuovo col profilo prudente", () => {
  withTenant(T, () => {
    const { dubbio } = prepara();
    forzaProposta(1, { hostId: dubbio, famiglia: "windows", chi: "r" }, no);
    assert.deepEqual(togliForzatura(1, dubbio), { ok: true });
    const r = riga(dubbio);
    assert.deepEqual([r.famiglia, r.stato, r.forzata_da_famiglia ?? null], ["da_chiarire", "proposto", null]);
    assert.deepEqual(ipAmmessiDellaRete(1), ["10.90.0.41"]);
    assert.equal(gruppiDaConfermate(leggiProposte(1)).find((g) => g.famiglia === "da_chiarire")?.profile, "fast");
    assert.equal(togliForzatura(1, dubbio).ok, false);
  });
});
