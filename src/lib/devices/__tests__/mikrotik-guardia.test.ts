/**
 * Guardia di GET /api/devices/[id]/mikrotik (21/10, scheda router e firewall): l'export completo della
 * configurazione RouterOS (`?action=config`, e `exportFull` dentro `?action=all`) contiene indirizzi, regole,
 * utenti e segreti di servizio: lo legge solo l'amministratore. Prima la GET chiedeva solo la sessione
 * (piano DADude3 B1 non ancora fatto su dev, verificato il 21/10).
 *
 * Incidente evitato: un utente viewer scarica l'export di un router di cliente con un GET.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/mikrotik-guardia.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { esitoAzioneMikrotik, configPerRuolo } from "../mikrotik-guardia";

describe("esitoAzioneMikrotik", () => {
  it("config: l'admin e il superadmin passano", () => {
    assert.deepEqual(esitoAzioneMikrotik("config", "admin"), { ok: true });
    assert.deepEqual(esitoAzioneMikrotik("config", "superadmin"), { ok: true });
  });
  it("config: un non admin riceve 403", () => {
    for (const ruolo of ["viewer", "operator", "", undefined]) {
      const r = esitoAzioneMikrotik("config", ruolo);
      assert.equal(r.ok, false, String(ruolo));
      assert.equal(r.ok === false && r.status, 403);
    }
  });
  it("le altre azioni restano a chi ha la sessione", () => {
    for (const a of ["dhcp", "servers", "pools", "dhcp-pool", "all"]) assert.deepEqual(esitoAzioneMikrotik(a, "viewer"), { ok: true }, a);
  });
});

describe("configPerRuolo", () => {
  const cfg = { exportFull: "/ip firewall ...", exportCompact: "x", systemInfo: { identity: "rtr", version: "7.15" } };
  it("admin: com'è", () => assert.deepEqual(configPerRuolo(cfg, "admin"), cfg));
  it("non admin: via l'export, resta l'identità del sistema", () => {
    assert.deepEqual(configPerRuolo(cfg, "viewer"), { exportFull: "", systemInfo: { identity: "rtr", version: "7.15" } });
  });
  it("config assente resta null", () => assert.equal(configPerRuolo(null, "viewer"), null));
});

describe("la rotta usa la guardia", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/devices/[id]/mikrotik/route.ts"), "utf8");
  const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
  it("la GET chiede la sessione e applica esitoAzioneMikrotik e configPerRuolo", () => {
    assert.match(get, /requireAuth\(\)/);
    assert.match(get, /esitoAzioneMikrotik\(/);
    assert.match(get, /configPerRuolo\(/);
  });
  it("il 403 arriva prima di cercare l'apparato: un non admin non ricava se l'id esiste", () => {
    assert.ok(get.indexOf("esitoAzioneMikrotik(") < get.indexOf("getNetworkDeviceById("), "guardia dopo la ricerca dell'apparato");
  });
  it("la lista degli admin è quella unica di eAdmin, non un duplicato", () => {
    const guardia = readFileSync(join(process.cwd(), "src/lib/devices/mikrotik-guardia.ts"), "utf8");
    assert.match(guardia, /eAdmin\(/);
    assert.doesNotMatch(guardia, /new Set\(\["admin"/);
  });
});
