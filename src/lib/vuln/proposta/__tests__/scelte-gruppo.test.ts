/**
 * Scelta per gruppo (Riccardo, 09/11/2026: «perché Windows giro minimo e non c'è un'opzione per cambiare per il
 * gruppo la modalità di scansione»; tavola oggetti 45-48 approvata). Di serie resta la tabella; una persona può
 * cambiare Greenbone, nuclei e moduli di una famiglia, per la rete, con la firma. Le scelte che alzano il rischio
 * vogliono una nota; gli impianti non si toccano; «da chiarire» sale al massimo a Bilanciato, senza nuclei né moduli.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/vuln/proposta/__tests__/scelte-gruppo.test.ts
 */
import "@/lib/vuln/__tests__/support/dati-isolati";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { gruppiDaConfermate } from "@/lib/vuln/proposta/gruppi";
import { quadroFamiglie } from "@/lib/vuln/proposta/quadro";
import { controllaScelta, leggiScelte, rischioDellaScelta, salvaScelta, togliScelta, type SceltaGruppo } from "@/lib/vuln/proposta/scelte-gruppo";
import type { Famiglia } from "@/lib/vuln/proposta/regole";
import type { RigaProposta } from "@/lib/vuln/proposta/store";
import type { EdgeAssessmentProfile } from "@/lib/vuln/edge-profiles";

const T = "TESTSCELTE09";
after(() => { deleteTenantDatabase(T); closeHubDb(); });

let n = 0;
const riga = (famiglia: Famiglia, o: Partial<RigaProposta> = {}): RigaProposta => {
  n++;
  return { host_id: n, ip: `10.0.0.${n}`, nome: null, famiglia, voce: "bilanciato", con_web: 0, confidenza: "alta",
    motivo: "prova", stato: "confermato", da_rivedere: 0, confermata_da: null, confermata_il: null, ...o };
};
const CATALOGO: EdgeAssessmentProfile[] = [
  { id: "completo-interno", label: "Completo interno", image: "advanced", requires_authorization: false,
    steps: ["service-fp", "cis-check", "ldap-enum", "enum4linux-ng", "snmp-enum", "smtp-enum", "tls-deep"] },
  { id: "smoke-interno", label: "Smoke interno", image: "advanced", requires_authorization: false, steps: ["service-fp"] },
];
const scelta = (famiglia: Famiglia, x: Partial<SceltaGruppo>): SceltaGruppo => ({
  famiglia, profile: null, nuclei: null, moduli: null, chi: "riccardo", nota: null, il: "2026-11-09 10:00:00", ...x,
});

test("senza scelte vale la tabella: Windows sul giro minimo", () => {
  const [w] = gruppiDaConfermate([riga("windows")], CATALOGO, []);
  assert.deepEqual([w.profile, w.nuclei_profilo, w.assessment_profile_id], ["balanced", "quick", "smoke-interno"]);
});

test("Windows col giro completo scelto da una persona parte coi moduli completi", () => {
  const [w] = gruppiDaConfermate([riga("windows")], CATALOGO, [scelta("windows", { moduli: "completi", nota: "utente AD concordato" })]);
  assert.equal(w.assessment_profile_id, "completo-interno");
  assert.equal(w.avviso, null);
});

test("nuclei «nessuno» e Greenbone scelto; la profondità più bassa di un device abbassa ancora il gruppo", () => {
  const g = gruppiDaConfermate([riga("periferiche")], CATALOGO, [scelta("periferiche", { nuclei: "nessuno", profile: "balanced" })]);
  assert.deepEqual([g[0].profile, g[0].nuclei_profilo], ["balanced", null]);
  const giu = gruppiDaConfermate([riga("linux", { voce: "veloce" })], CATALOGO, [scelta("linux", { profile: "deep", nota: "x" })]);
  assert.equal(giu[0].profile, "fast");
});

test("«da chiarire»: al massimo Bilanciato, niente nuclei né moduli; impianti mai", () => {
  assert.equal(controllaScelta("da_chiarire", { profile: "balanced", nuclei: null, moduli: null }), null);
  assert.match(controllaScelta("da_chiarire", { profile: "deep", nuclei: null, moduli: null }) ?? "", /Bilanciato/);
  assert.match(controllaScelta("da_chiarire", { profile: null, nuclei: "quick", moduli: null }) ?? "", /nuclei/);
  assert.match(controllaScelta("impianti", { profile: "fast", nuclei: null, moduli: null }) ?? "", /impianti/i);
  const [d] = gruppiDaConfermate([riga("da_chiarire")], CATALOGO, [scelta("da_chiarire", { profile: "balanced", nuclei: "standard" })]);
  assert.deepEqual([d.profile, d.nuclei_profilo, d.assessment_profile_id], ["balanced", null, null], "anche una scelta sbagliata salvata non passa");
});

test("le scelte che alzano il rischio lo dicono, le altre no", () => {
  assert.match(rischioDellaScelta("windows", { profile: null, nuclei: null, moduli: "completi" }) ?? "", /enum4linux/);
  assert.ok(rischioDellaScelta("rete", { profile: null, nuclei: null, moduli: "completi" }));
  assert.ok(rischioDellaScelta("linux", { profile: "deep", nuclei: null, moduli: null }));
  assert.ok(rischioDellaScelta("periferiche", { profile: null, nuclei: "standard", moduli: null }));
  assert.equal(rischioDellaScelta("periferiche", { profile: null, nuclei: "nessuno", moduli: null }), null);
  assert.equal(rischioDellaScelta("linux", { profile: "fast", nuclei: null, moduli: "completi" }), null);
});

test("archivio: per rete, firmata, «torna alla tabella» la toglie; il quadro mostra scelta e firma", () => {
  withTenant(T, () => {
    const db = getTenantDb(T);
    db.prepare("INSERT OR IGNORE INTO networks (id, cidr, name) VALUES (1, '10.0.0.0/24', 'A'), (2, '10.0.1.0/24', 'B')").run();
    salvaScelta(1, { famiglia: "windows", profile: null, nuclei: null, moduli: "completi" }, "riccardo", "utente AD concordato");
    assert.equal(leggiScelte(2).length, 0, "vale per la rete");
    const [s] = leggiScelte(1);
    assert.deepEqual([s.famiglia, s.moduli, s.chi, s.nota], ["windows", "completi", "riccardo", "utente AD concordato"]);
    const q = quadroFamiglie([riga("windows")], leggiScelte(1));
    assert.equal(q[0].moduli, "Giro completo");
    assert.equal(q[0].scelta?.chi, "riccardo");
    assert.deepEqual(q[0].valori, { profile: "balanced", nuclei: "quick", moduli: "completi" });
    togliScelta(1, "windows");
    assert.equal(leggiScelte(1).length, 0);
    assert.equal(quadroFamiglie([riga("windows")], leggiScelte(1))[0].moduli, "Giro minimo");
  });
});
