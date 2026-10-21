/**
 * Riquadro «Credenziali assegnate» (tappa 5, 21/10): l'esito di ogni credenziale in uso viene dal
 * suo binding, il badge «senza credenziale provata» compare solo senza nessun binding riuscito.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/credenziali-assegnate.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hostGestitoSenzaProva, righeAssegnate, senzaCredenzialeProvata, type BindingPerEsito } from "@/lib/devices/credenziali-assegnate";
import type { UsataAdesso } from "@/lib/devices/usata-adesso";

const ssh: UsataAdesso = { ruolo: "principale", protocollo: "ssh", credential_id: 7, nome: "admin-mikrotik", fonte: "device_binding", porta: 22, motivo: null };
const snmp: UsataAdesso = { ruolo: "snmp", protocollo: "snmp", credential_id: 9, nome: "snmp-lettura", fonte: "device_binding", porta: 161, motivo: null };
const b = (id: number, cred: number | null, proto: string, st: BindingPerEsito["test_status"], at: string | null = null): BindingPerEsito => ({
  id, credential_id: cred, protocol_type: proto, test_status: st, tested_at: at,
});
const nome = () => "binding dell'apparato";

describe("righeAssegnate", () => {
  it("abbina voce e protocollo al binding e ne prende esito e data", () => {
    const r = righeAssegnate([ssh, snmp], [b(1, 7, "ssh", "success", "2026-10-21 07:41:00"), b(2, 9, "snmp", "failed")], nome);
    assert.deepEqual(r.map((x) => [x.per, x.esito, x.bindingId]), [["SSH · 22", "riuscita", 1], ["SNMP · 161", "rifiutata", 2]]);
    assert.equal(r[0].testedAt, "2026-10-21 07:41:00");
  });
  it("SNMP a community: la versione rilevata sta nell'etichetta", () => {
    assert.equal(righeAssegnate([snmp], [], nome, "v2c")[0].per, "SNMP v2c · 161");
    assert.equal(righeAssegnate([ssh], [], nome, "v2c")[0].per, "SSH · 22");
  });
  it("stessa voce su un altro protocollo non conta", () => {
    const r = righeAssegnate([ssh], [b(5, 7, "winrm", "success")], nome);
    assert.equal(r[0].esito, "non_provata");
    assert.equal(r[0].bindingId, null);
  });
  it("«public» o nessuna credenziale: non provata, niente binding da provare", () => {
    const r = righeAssegnate([{ ...snmp, credential_id: null, nome: "public", fonte: "snmp_ripiego" }, { ...ssh, credential_id: null, nome: null, fonte: null, porta: null, motivo: "Nessun binding" }], [], nome);
    assert.deepEqual(r.map((x) => [x.nome, x.esito, x.bindingId]), [["public", "non_provata", null], ["Nessuna", "non_provata", null]]);
    assert.equal(r[1].nota, "Nessun binding");
  });
});

describe("senzaCredenzialeProvata", () => {
  it("con l'host: conta solo le credenziali validate sull'host (la stessa regola delle liste)", () => {
    assert.equal(senzaCredenzialeProvata(0), true);
    assert.equal(senzaCredenzialeProvata(2), false);
    // un binding riuscito ma mai promosso sull'host NON basta: card e liste devono dire la stessa cosa
    assert.equal(senzaCredenzialeProvata(0, [b(1, 1, "snmp", "success")]), true);
  });
  it("senza host (apparato creato a mano, nessun'altra fonte): vale la prova dei binding", () => {
    assert.equal(senzaCredenzialeProvata(null, []), true);
    assert.equal(senzaCredenzialeProvata(undefined, [b(1, 1, "ssh", "untested"), b(2, 2, "snmp", "failed")]), true);
    assert.equal(senzaCredenzialeProvata(null, [b(1, 1, "ssh", "failed"), b(2, 2, "snmp", "success")]), false);
  });
});

describe("hostGestitoSenzaProva (liste)", () => {
  it("solo gli apparati: un host non gestito non è «senza credenziale provata»", () => {
    assert.equal(hostGestitoSenzaProva(undefined, []), false);
    assert.equal(hostGestitoSenzaProva(4, []), true);
    assert.equal(hostGestitoSenzaProva(4, undefined), true);
    assert.equal(hostGestitoSenzaProva(4, ["ssh"]), false);
  });
});
