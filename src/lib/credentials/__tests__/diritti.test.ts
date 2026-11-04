/**
 * Catalogo unico dei diritti (Task 6, 04/11/2026).
 *
 * INCIDENTE: tre guide si contraddicevano. La guida del DC chiedeva Administrators sul DC per WinRM
 * mentre il manuale degli eventi dice Event Log Readers + Remote Management Users; il manuale WinRM
 * dava Domain Admins come «necessario»; due guide scrivevano una password d'esempio in chiaro.
 * Ora la definizione sta in `diritti.ts` e le guide la leggono: questa prova tiene il catalogo
 * completo e impedisce che i nomi dei gruppi tornino scritti a mano nei componenti.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/diritti.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DIRITTI, FAMIGLIE_DIRITTI, GRUPPI, REGOLE_DIRITTI, dirittiDi, dirittoPerId } from "../diritti";

const IDS_ATTESI = [
  "inventario_wmi",
  "inventario_winrm",
  "software_patch",
  "account_dominio",
  "eventi_dc",
  "audit_gpo",
  "dhcp",
];

/** I componenti che leggono il catalogo: i nomi dei gruppi non devono comparire scritti a mano. */
const FILE_CHE_LEGGONO = [
  "src/components/shared/ad-setup-guide-dialog.tsx",
  "src/components/shared/winrm-setup-guide-dialog.tsx",
  "src/components/shared/guida-audit-dc.tsx",
  "src/app/(dashboard)/sicurezza-dominio/sicurezza-dominio-client.tsx",
  "src/lib/devices/device-connection-test.ts",
];
const NOMI_GRUPPI = /Event Log Readers|Remote Management Users|DHCP Administrators|Domain Admins|\bAdministrators\b/;

describe("catalogo dei diritti: forma", () => {
  it("ha le sette voci previste, una per id", () => {
    assert.deepEqual(DIRITTI.map((d) => d.id), IDS_ATTESI);
    assert.equal(new Set(DIRITTI.map((d) => d.id)).size, DIRITTI.length);
  });

  it("ogni voce ha tutti i campi pieni", () => {
    for (const d of DIRITTI) {
      for (const campo of ["id", "funzione", "abilitare", "dove"] as const) {
        assert.ok(d[campo].trim().length > 0, `${d.id}: «${campo}» vuoto`);
      }
      assert.ok(d.famiglia === "utente_scansioni" || d.famiglia === "sicurezza_dominio", `${d.id}: famiglia`);
      assert.equal(typeof d.obbligatorio, "boolean", `${d.id}: obbligatorio`);
      if (d.comandoIt !== undefined) assert.ok(d.comandoIt.trim().length > 0, `${d.id}: comandoIt vuoto`);
    }
  });

  it("le due famiglie hanno un nome e le voci previste", () => {
    assert.deepEqual(Object.keys(FAMIGLIE_DIRITTI).sort(), ["sicurezza_dominio", "utente_scansioni"]);
    assert.deepEqual(dirittiDi("utente_scansioni").map((d) => d.id), ["inventario_wmi", "inventario_winrm", "software_patch"]);
    assert.deepEqual(dirittiDi("sicurezza_dominio").map((d) => d.id), ["account_dominio", "eventi_dc", "audit_gpo", "dhcp"]);
  });

  it("dirittoPerId trova la voce e dice no su un id sconosciuto", () => {
    assert.equal(dirittoPerId("eventi_dc").funzione, "Eventi di sicurezza dei DC");
    assert.throws(() => dirittoPerId("non_esiste"), /non_esiste/);
  });
});

describe("catalogo dei diritti: contenuto", () => {
  it("eventi e DHCP sul DC: gruppi giusti, mai Administrators", () => {
    const eventi = dirittoPerId("eventi_dc");
    assert.equal(eventi.abilitare, `${GRUPPI.lettoriRegistri} + ${GRUPPI.gestioneRemota}`);
    assert.equal(eventi.dove, "DC");
    const dhcp = dirittoPerId("dhcp");
    assert.equal(dhcp.abilitare, `${GRUPPI.dhcpAdmin} + ${GRUPPI.gestioneRemota}`);
    for (const d of dirittiDi("sicurezza_dominio")) {
      assert.doesNotMatch(d.abilitare, /\bAdministrators\b(?! \+)/, `${d.id}: Administrators sul DC`);
      assert.doesNotMatch(d.comandoIt ?? "", /Add-LocalGroupMember|"Administrators"/, `${d.id}: Administrators sul DC`);
    }
  });

  it("inventario e patch sui PC: Administrators locale", () => {
    for (const id of ["inventario_wmi", "inventario_winrm", "software_patch"]) {
      const d = dirittoPerId(id);
      assert.match(d.abilitare, /Administrators locale/, id);
      assert.equal(d.dove, "PC e server", id);
      assert.equal(d.famiglia, "utente_scansioni", id);
    }
  });

  it("i gruppi Builtin dei DC si riempiono con Add-ADGroupMember e l'esempio svc-ipam", () => {
    for (const id of ["eventi_dc", "dhcp"]) {
      const cmd = dirittoPerId(id).comandoIt ?? "";
      assert.match(cmd, /Add-ADGroupMember/, id);
      assert.match(cmd, /svc-ipam/, id);
      assert.doesNotMatch(cmd, /Add-LocalGroupMember/, id);
    }
  });

  it("nessuna password d'esempio in chiaro: dove si crea l'account si legge da Read-Host", () => {
    for (const d of DIRITTI) {
      const cmd = d.comandoIt ?? "";
      assert.doesNotMatch(cmd, /-AsPlainText/i, `${d.id}: password in chiaro`);
      assert.doesNotMatch(cmd, /PasswordLunga|Password!?\d|P@ss/i, `${d.id}: password d'esempio`);
      if (/New-ADUser|ConvertTo-SecureString/.test(cmd)) assert.match(cmd, /Read-Host[^\n]*-AsSecureString/, d.id);
    }
    assert.match(dirittoPerId("account_dominio").comandoIt ?? "", /New-ADUser/);
  });

  it("la regola: mai Domain Admins, account delle scansioni separato da quello di sola lettura", () => {
    assert.ok(REGOLE_DIRITTI.some((r) => /mai/i.test(r) && r.includes(GRUPPI.domainAdmins)));
    assert.ok(REGOLE_DIRITTI.some((r) => /separat/i.test(r)));
    for (const d of DIRITTI) {
      assert.doesNotMatch(`${d.abilitare} ${d.comandoIt ?? ""}`, /Domain Admins/, `${d.id}: Domain Admins nel catalogo`);
    }
  });
});

describe("le guide leggono dal catalogo", () => {
  for (const file of FILE_CHE_LEGGONO) {
    it(`${file}: niente nomi dei gruppi scritti a mano`, () => {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      // I commenti non contano: il nome di un gruppo vi compare come racconto di un evento, non come guida.
      const righe = src
        .split("\n")
        .flatMap((riga, i) => (!/^\s*(\/\/|\/\*|\*)/.test(riga) && NOMI_GRUPPI.test(riga) ? [`${i + 1}: ${riga.trim()}`] : []));
      assert.deepEqual(righe, [], `nomi dei gruppi fuori da diritti.ts:\n${righe.join("\n")}`);
    });
  }

  for (const file of FILE_CHE_LEGGONO.slice(0, 4)) {
    it(`${file}: importa il catalogo`, () => {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      assert.match(src, /from "@\/lib\/credentials\/diritti"/);
    });
  }
});
