/**
 * Decisione (e) di fine giro 2: nella scansione in blocco (`POST /api/devices/bulk-scan`) gli apparati nel caso dubbio
 * dell'acquisizione modulare si saltano e si elencano nell'esito, senza chiedere la rotta d'acquisizione (che risponderebbe
 * 409) e senza fermare gli altri. Interruttore spento = nessun apparato saltato per questo motivo.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d)" node --import tsx --test src/lib/acquisizione-modulare/__tests__/bulk-dubbi.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dubbioDaSaltare, type DipendenzeFonte } from "@/lib/acquisizione-modulare/fonte";

const vietato = (cosa: string) => () => { throw new Error(`con l'interruttore spento non si legge ${cosa}`); };
const cred = () => [{ protocollo: "ssh" as const, credential_id: 9, nome: "lettura", port: 22 }];

describe("dubbioDaSaltare", () => {
  it("interruttore spento: null, senza leggere scelta né credenziali", () => {
    const deps: DipendenzeFonte = { accesa: () => false, scelta: vietato("la scelta"), candidati: vietato("le credenziali") };
    assert.equal(dubbioDaSaltare({ id: 1, name: "sw-a", vendor: "hp", device_type: "switch" }, deps), null);
  });

  it("due collector possibili: saltato, col motivo e la frase per l'esito", () => {
    const s = dubbioDaSaltare({ id: 3, name: "sw-b", vendor: "hp", device_type: "switch" }, { accesa: () => true, scelta: () => null, candidati: cred });
    assert.ok(s);
    assert.equal(s.id, 3);
    assert.equal(s.name, "sw-b");
    assert.equal(s.motivo, "due_collector");
    assert.match(s.reason, /hp-procurve o hp-comware/);
  });

  it("nessuna credenziale compatibile: saltato", () => {
    const s = dubbioDaSaltare({ id: 4, name: "sw-c", vendor: "hp", vendor_subtype: "procurve", device_type: "switch" }, { accesa: () => true, scelta: () => null, candidati: () => [] });
    assert.equal(s?.motivo, "credenziali");
  });

  it("fonte pronta o nessun collector: non si salta", () => {
    assert.equal(dubbioDaSaltare({ id: 5, name: "sw-d", vendor: "hp", vendor_subtype: "procurve", device_type: "switch" }, { accesa: () => true, scelta: () => null, candidati: cred }), null);
    assert.equal(dubbioDaSaltare({ id: 6, name: "rt", vendor: "mikrotik", device_type: "router" }, { accesa: () => true, scelta: () => null, candidati: cred }), null);
  });
});

describe("rotta POST /api/devices/bulk-scan", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/devices/bulk-scan/route.ts"), "utf8");

  it("salta i dubbi prima del test delle credenziali e li elenca nell'esito", () => {
    const i = src.indexOf("dubbioDaSaltare(device, deps)");
    assert.ok(i > 0, "la rotta chiede dubbioDaSaltare");
    assert.ok(i < src.indexOf("/api/devices/${id}/test"), "prima del test delle credenziali");
    assert.match(src, /dubbi\.push\(dubbio\)/);
    assert.match(src, /dubbi,\s*\n/);
  });
});
