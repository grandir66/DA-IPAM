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
  it("admin: com'è, più le sezioni tolte (nessuna qui)", () => assert.deepEqual(configPerRuolo(cfg, "admin"), { ...cfg, exportTolte: [] }));
  it("non admin: via l'export, resta l'identità del sistema", () => {
    assert.deepEqual(configPerRuolo(cfg, "viewer"), { exportFull: "", systemInfo: { identity: "rtr", version: "7.15" } });
  });
  it("config assente resta null", () => assert.equal(configPerRuolo(null, "viewer"), null));
  // 22/10, revisione finale: la ripulitura girava solo nel browser; la vecchia pagina /devices/[id] mostrava e
  // scaricava l'export grezzo, con la password SFTP dello script di backup del Manager in /system script.
  it("admin: entrambi gli export arrivano senza /system script né /system scheduler", () => {
    const grezzo = "/system scheduler\nadd name=b on-event=mikrotik_backup\n/system script\nadd name=mikrotik_backup source=\"/tool fetch url=sftp://u:SEGRETO@h\"\n/ip dns\nset servers=1.1.1.1\n";
    const r = configPerRuolo({ exportFull: grezzo, exportCompact: grezzo, systemInfo: { identity: "rtr" } }, "admin");
    const json = JSON.stringify(r);
    assert.ok(!json.includes("/system script"), "niente /system script");
    assert.ok(!json.includes("/system scheduler"), "niente /system scheduler");
    assert.ok(!json.includes("SEGRETO"));
    assert.ok(r && "exportFull" in r && r.exportFull.includes("/ip dns"), "il resto resta");
    assert.ok(r && "exportCompact" in r && typeof r.exportCompact === "string" && r.exportCompact.includes("/ip dns"));
    assert.deepEqual(r && "exportTolte" in r ? r.exportTolte : null, ["system scheduler", "system script"]);
  });
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
