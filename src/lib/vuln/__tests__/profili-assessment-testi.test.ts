import { describe, it } from "node:test";
import assert from "node:assert";
import { contaModuli, descriviModulo, descriviProfilo } from "../profili-assessment-testi";
import type { EdgeAssessmentProfile } from "../edge-profiles";

/**
 * Il catalogo vero della sonda (DA-Vul-can, `data/assessment_profiles.json`): se
 * là dentro nasce un modulo o un profilo, qui deve nascere la sua descrizione,
 * altrimenti in pagina ricompare un nome muto.
 */
const CATALOGO: EdgeAssessmentProfile[] = [
  {
    id: "validation-plus",
    label: "Validation plus",
    image: "advanced",
    requires_authorization: true,
    steps: ["enum4linux-ng", "ldap-enum", "cred-bind", "tls-deep", "cis-check", "service-fp", "snmp-enum"],
  },
  {
    id: "safe-esterno",
    label: "Safe esterno",
    image: "advanced",
    requires_authorization: false,
    steps: ["amass", "dns-enum", "tls-deep"],
  },
  {
    id: "smoke-interno",
    label: "Smoke interno",
    image: "advanced",
    requires_authorization: false,
    steps: ["service-fp"],
  },
  {
    id: "completo-interno",
    label: "Completo interno",
    image: "advanced",
    requires_authorization: false,
    steps: ["service-fp", "cis-check", "ldap-enum", "enum4linux-ng", "snmp-enum", "smtp-enum", "tls-deep"],
  },
];

function profilo(over: Partial<EdgeAssessmentProfile>): EdgeAssessmentProfile {
  return {
    id: "x",
    label: "X",
    image: "advanced",
    requires_authorization: false,
    steps: [],
    ...over,
  };
}

describe("descriviProfilo — catalogo vero della sonda", () => {
  for (const p of CATALOGO) {
    it(`«${p.label}» ha la sua descrizione e il «quando»`, () => {
      const d = descriviProfilo(p);
      assert.equal(d.descritto, true, `il profilo ${p.id} non è descritto in DA-IPAM`);
      assert.ok(d.aCosaServe.length > 40, "la descrizione è troppo corta per spiegare qualcosa");
      assert.ok(d.quando && d.quando.length > 20, "manca il «quando» del profilo");
      assert.equal(d.moduli.length, p.steps.length);
    });
  }

  it("ogni modulo usato dai profili del catalogo è descritto, nessuno cade sul ripiego", () => {
    const senzaDescrizione = [...new Set(CATALOGO.flatMap((p) => p.steps))]
      .map((m) => ({ m, d: descriviModulo(m) }))
      .filter((x) => !x.d.descritto)
      .map((x) => x.m);
    assert.deepEqual(senzaDescrizione, [], "moduli del catalogo senza descrizione in DA-IPAM");
  });
});

describe("descriviProfilo — quello che l'edge aggiunge e qui non c'è", () => {
  it("un profilo sconosciuto si descrive coi suoi moduli, e lo dice", () => {
    const d = descriviProfilo(profilo({ id: "profilo-nuovo", steps: ["service-fp", "tls-deep"] }));
    assert.equal(d.descritto, false);
    assert.equal(d.quando, null);
    assert.match(d.aCosaServe, /2 moduli/);
    assert.deepEqual(
      d.moduli.map((m) => m.nome),
      ["Impronta dei servizi", "TLS a fondo"]
    );
  });

  it("un profilo sconosciuto e senza moduli dice che non farebbe niente", () => {
    const d = descriviProfilo(profilo({ id: "vuoto", steps: [] }));
    assert.match(d.aCosaServe, /non farebbe niente/);
    assert.deepEqual(d.moduli, []);
  });

  it("un modulo sconosciuto resta visibile col suo id", () => {
    const m = descriviModulo("modulo-mai-visto");
    assert.equal(m.nome, "modulo-mai-visto");
    assert.equal(m.descritto, false);
    assert.match(m.cosaFa, /non ancora descritto/);
  });
});

describe("contaModuli", () => {
  it("singolare, plurale e nessuno", () => {
    assert.equal(contaModuli(profilo({ steps: ["service-fp"] })), "1 modulo");
    assert.equal(contaModuli(profilo({ steps: ["service-fp", "tls-deep"] })), "2 moduli");
    assert.equal(contaModuli(profilo({ steps: [] })), "nessun modulo");
  });
});
