/**
 * Dalle proposte confermate ai gruppi da lanciare (piano profili-per-device, Passo 4, 06/11/2026).
 *
 * Perché: al 72729 nove PLC sono spariti dentro una scansione della loro rete (05-06/11/2026; la causa
 * NON è accertata: gli orari somigliano anche a una macchina accesa a turni). Qualunque sia la causa,
 * mandare a un impianto i controlli di un server è sbagliato: l'elenco degli IP da lanciare nasce qui e
 * qui sta la prova che IoT/OT e «Da chiarire» non producono mai un gruppo, e che una proposta non
 * confermata non parte. Il freno di Edge resta sotto: questa è la prima barriera, non l'unica.
 *
 * Run: node --import tsx --test src/lib/vuln/proposta/__tests__/gruppi.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gruppiDaConfermate } from "@/lib/vuln/proposta/gruppi";
import type { RigaProposta } from "@/lib/vuln/proposta/store";
import type { Famiglia } from "@/lib/vuln/proposta/regole";
import type { EdgeAssessmentProfile } from "@/lib/vuln/edge-profiles";

let n = 0;
function riga(famiglia: Famiglia, o: Partial<RigaProposta> = {}): RigaProposta {
  n++;
  return {
    host_id: n, ip: `10.0.0.${n}`, nome: null, famiglia, voce: "bilanciato", con_web: 0, confidenza: "alta",
    motivo: "prova", stato: "confermato", da_rivedere: 0, confermata_da: "admin", confermata_il: "2026-11-06 10:00:00", ...o,
  };
}

// Forma vera di GET /api/v1/profiles (catalogo di Edge, assessment_profiles.json), ordinato per id.
const CATALOGO: EdgeAssessmentProfile[] = [
  { id: "completo-interno", label: "Completo interno", image: "advanced", requires_authorization: false,
    steps: ["service-fp", "cis-check", "ldap-enum", "enum4linux-ng", "snmp-enum", "smtp-enum", "tls-deep"] },
  { id: "safe-esterno", label: "Safe esterno", image: "advanced", requires_authorization: false, steps: ["amass", "dns-enum", "tls-deep"] },
  { id: "smoke-interno", label: "Smoke interno", image: "advanced", requires_authorization: false, steps: ["service-fp"] },
  { id: "validation-plus", label: "Validation plus", image: "advanced", requires_authorization: true,
    steps: ["enum4linux-ng", "ldap-enum", "cred-bind", "tls-deep", "cis-check", "service-fp", "snmp-enum"] },
];

const tutte = () => [
  riga("rete"), riga("windows"), riga("linux"), riga("web"), riga("periferiche", { voce: "veloce" }),
];

test("una riga per famiglia, coi profili della tabella del piano", () => {
  const g = gruppiDaConfermate(tutte(), CATALOGO);
  assert.deepEqual(
    g.map((x) => [x.famiglia, x.profile, x.nuclei_profilo, x.assessment_profile_id]),
    [
      ["rete", "balanced", "gestione", "smoke-interno"],
      ["windows", "balanced", "quick", "smoke-interno"],
      ["linux", "balanced", "standard", "completo-interno"],
      ["web", "balanced", "standard", null],
      ["periferiche", "fast", "gestione", "smoke-interno"],
    ],
  );
  assert.ok(g.every((x) => x.ips.length === 1));
});

test("più host della stessa famiglia stanno in un gruppo solo, senza doppioni", () => {
  const a = riga("windows", { ip: "10.0.1.5" });
  const b = riga("windows", { ip: "10.0.1.6" });
  const dup = riga("windows", { ip: "10.0.1.5" });
  const g = gruppiDaConfermate([a, b, dup], CATALOGO);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].ips, ["10.0.1.5", "10.0.1.6"]);
});

test("IoT/OT e Da chiarire non producono mai un gruppo, nemmeno se risultano confermati", () => {
  const righe = [
    riga("impianti", { voce: null }), riga("impianti", { voce: "bilanciato" }),
    riga("da_chiarire", { voce: null }), riga("da_chiarire", { voce: "bilanciato" }),
  ];
  assert.deepEqual(gruppiDaConfermate(righe, CATALOGO), []);
  // e non contaminano un gruppo vero: gli IP dell'impianto non ci finiscono
  const g = gruppiDaConfermate([...righe, riga("rete", { ip: "10.0.2.1" })], CATALOGO);
  assert.deepEqual(g.map((x) => x.ips), [["10.0.2.1"]]);
  assert.ok(!g.flatMap((x) => x.ips).some((ip) => righe.some((r) => r.ip === ip)));
});

test("proposte non confermate, escluse e da rivedere non partono", () => {
  const g = gruppiDaConfermate([
    riga("rete", { stato: "proposto" }),
    riga("windows", { stato: "escluso" }),
    riga("linux", { da_rivedere: 1 }),
    riga("web", { ip: "" }),
  ], CATALOGO);
  assert.deepEqual(g, []);
});

test("nel dubbio si scende: una scelta più bassa vale, una più alta no", () => {
  const veloce = gruppiDaConfermate([riga("linux", { voce: "veloce" }), riga("linux", { voce: "bilanciato" })], CATALOGO);
  assert.equal(veloce[0].profile, "fast");
  assert.equal(veloce[0].assessment_profile_id, "smoke-interno", "sotto il bilanciato non si dà il giro completo");
  const profondo = gruppiDaConfermate([riga("linux", { voce: "profondo" })], CATALOGO);
  assert.equal(profondo[0].profile, "balanced", "il profondo non sale da qui: costa 8-24 ore su un solo gruppo");
});

test("regola 5: nessun modulo con credenziali deboli su Windows, domini, router e firewall", () => {
  const g = gruppiDaConfermate(tutte(), CATALOGO);
  const idDebole = new Set(CATALOGO.filter((p) => p.steps.includes("snmp-enum")).map((p) => p.id));
  for (const x of g.filter((y) => y.famiglia === "rete" || y.famiglia === "windows")) {
    assert.ok(x.assessment_profile_id === null || !idDebole.has(x.assessment_profile_id), x.famiglia);
  }
  // Se un domani il profilo base prende snmp-enum, Windows e Rete restano senza assessment, non con quello.
  const peggiorato = CATALOGO.map((p) => (p.id === "smoke-interno" ? { ...p, steps: [...p.steps, "snmp-enum"] } : p));
  const g2 = gruppiDaConfermate(tutte(), peggiorato);
  assert.equal(g2.find((x) => x.famiglia === "rete")?.assessment_profile_id, null);
  assert.equal(g2.find((x) => x.famiglia === "windows")?.assessment_profile_id, null);
});

test("senza catalogo (sonda che non risponde) nessun assessment, e il resto non cambia", () => {
  const g = gruppiDaConfermate(tutte());
  assert.ok(g.every((x) => x.assessment_profile_id === null));
  assert.equal(g.length, 5);
});

test("un profilo che chiede l'autorizzazione scritta non si sceglie da solo", () => {
  const solo = CATALOGO.map((p) => (p.id === "completo-interno" ? { ...p, requires_authorization: true } : p));
  // si scende al profilo più basso che non lo chiede, non si sale e non si lancia quello
  assert.equal(gruppiDaConfermate([riga("linux")], solo)[0].assessment_profile_id, "smoke-interno");
});

test("regola 5 fail-closed: per Rete e Windows vale solo un modulo ammesso, uno nuovo non passa", () => {
  // Un modulo che il catalogo aggiunge domani e che qui nessuno ha giudicato: non è «non debole», è ignoto.
  const nuovo = CATALOGO.map((p) => (p.id === "smoke-interno" ? { ...p, steps: [...p.steps, "modulo-mai-visto"] } : p));
  const g = gruppiDaConfermate(tutte(), nuovo);
  for (const f of ["rete", "windows"]) {
    const x = g.find((y) => y.famiglia === f)!;
    assert.equal(x.assessment_profile_id, null, f);
    assert.match(x.avviso ?? "", /assessment/i, "il gruppo resta senza assessment e lo dice");
  }
  // Linux e Periferiche non sono nella regola: il loro profilo resta
  assert.equal(g.find((y) => y.famiglia === "periferiche")!.assessment_profile_id, "smoke-interno");
  // il catalogo attuale dà ancora il giro minimo, senza avviso
  const ok = gruppiDaConfermate(tutte(), CATALOGO);
  assert.equal(ok.find((y) => y.famiglia === "rete")!.assessment_profile_id, "smoke-interno");
  assert.equal(ok.find((y) => y.famiglia === "rete")!.avviso, null);
});
