/**
 * Lo script completo che prepara il dominio per DA-IPAM (Riccardo, 08/11/2026: «è scomparsa la pagina
 * su come configurare i diritti … dovresti generare uno script completo che eseguito con privilegi
 * elevati costruisce il necessario, oltre al documento di cosa fa e i passi per farlo a mano»).
 *
 * Cade se lo script non si raggiunge più dalla pagina «Cosa serve», se la pagina sparisce da
 * «Sicurezza del dominio», se lo script cambia qualcosa senza -Applica, o se i suoi gruppi e account
 * si staccano da diritti.ts (la fonte unica dei diritti).
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/prepara-dominio.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FAMIGLIE_DIRITTI, GRUPPI } from "../diritti";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SCRIPT = src("scripts/Prepara-Dominio-DA-IPAM.ps1");

test("lo script usa i gruppi e gli account di diritti.ts", () => {
  for (const g of [GRUPPI.lettoriRegistri, GRUPPI.gestioneRemota, GRUPPI.dhcpAdmin, GRUPPI.domainAdmins]) {
    assert.ok(SCRIPT.includes(`'${g}'`), `manca il gruppo ${g}`);
  }
  assert.ok(SCRIPT.includes(`$AccountDc = '${FAMIGLIE_DIRITTI.sicurezza_dominio.accountEsempio}'`));
  assert.ok(SCRIPT.includes(`$AccountScansioni = '${FAMIGLIE_DIRITTI.utente_scansioni.accountEsempio}'`));
});

const SCRIVONO = /\b(New-ADUser|Enable-ADAccount|Add-ADGroupMember|New-ADGroup|New-GPO|New-GPLink|Set-GPRegistryValue|New-NetFirewallRule|Set-NetFirewallRule|Set-ADObject|Set-Content|New-Item)\b/;

/** Righe che scrivono (AD, GPO, SYSVOL) fuori da un blocco `Cambia "…" { … }`. */
function fuoriDaCambia(testo: string): string[] {
  const fuori: string[] = [];
  let profondita = 0; // graffe aperte dal «Cambia» che contiene la riga; 0 = fuori
  for (const riga of testo.split("\n")) {
    const t = riga.trim();
    const apre = (riga.match(/\{/g) ?? []).length;
    const chiude = (riga.match(/\}/g) ?? []).length;
    if (profondita === 0 && /^Cambia\s+"/.test(t) || profondita === 0 && /\{\s*Cambia\s+"/.test(t) || profondita === 0 && /\belse\s*\{\s*Cambia\s+"/.test(t)) {
      profondita = Math.max(apre - chiude, 0);
      continue; // la riga d'apertura (e un blocco su una riga sola) sta dentro Cambia
    }
    if (profondita > 0) {
      profondita += apre - chiude;
      if (profondita < 0) profondita = 0;
      continue;
    }
    if (SCRIVONO.test(t) && !t.startsWith("#")) fuori.push(t);
  }
  return fuori;
}

test("di serie non cambia niente: senza -Applica, Cambia descrive e basta", () => {
  assert.match(SCRIPT, /\[switch\]\$Applica/);
  assert.match(SCRIPT, /\$Prova = -not \$Applica/);
  assert.match(SCRIPT, /function Cambia\([^)]*\) \{\s*if \(\$Prova\) \{ Farei \$descrizione; return \}/);
});

test("ogni comando che scrive sta dentro un blocco Cambia", () => {
  assert.deepEqual(fuoriDaCambia(SCRIPT), []);
});

test("la prova sopra cade davvero su uno script che scrive fuori da Cambia", () => {
  const finto = [
    'Cambia "creo il gruppo" {',
    "  New-ADGroup -Name X",
    "}",
    "Add-ADGroupMember -Identity X -Members y",
  ].join("\n");
  assert.deepEqual(fuoriDaCambia(finto), ["Add-ADGroupMember -Identity X -Members y"]);
});

test("lo script si ferma prima di mettere la GPO delle scansioni sui DC", () => {
  assert.ok(SCRIPT.includes("-OuComputer non puo' essere l'OU Domain Controllers"));
  assert.ok(SCRIPT.includes("-OuComputer non puo' essere la radice del dominio"));
  assert.ok(SCRIPT.includes("PrimaryGroupID -eq 516"));
});

test("la pagina «Cosa serve» offre lo script, l'audit e il documento; «Sicurezza del dominio» porta lì", () => {
  const pagina = src("src/components/credentials/cosa-serve.tsx");
  assert.ok(pagina.includes("/api/ad-setup/script-dominio"));
  assert.ok(pagina.includes("/api/ad-setup/script-audit"));
  assert.ok(pagina.includes("/manual?doc=prepara-dominio"));
  assert.ok(src("src/app/api/ad-setup/script-dominio/route.ts").includes("Prepara-Dominio-DA-IPAM.ps1"));
  assert.ok(src("src/app/(dashboard)/sicurezza-dominio/sicurezza-dominio-schede.tsx").includes("/active-directory/cosa-serve"));
  assert.ok(src("docs/PREPARA-DOMINIO.md").includes("## Cosa fa, passo per passo (e come farlo a mano)"));
});
