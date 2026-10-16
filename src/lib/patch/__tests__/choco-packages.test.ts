import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMeshAgentChocoScript,
  buildGlpiAgentChocoScript,
  CHOCO_PACKAGE_IDS,
} from "@/lib/patch/choco-packages";

/** Nessuna riga deve iniziare con '@ (chiuderebbe l'here-string @'...'@). */
function assertNoStrayHereStringClose(script: string) {
  const strayLines = script.split("\n").filter((l) => /^\s*'@/.test(l));
  // Le uniche chiusure legittime sono le righe che chiudono i 3 blocchi @'...'@,
  // che nel nostro template sono esattamente "'@ | Set-Content ..." (con testo dopo).
  for (const l of strayLines) {
    assert.ok(
      /^'@ \| Set-Content/.test(l.trim()),
      `riga sospetta che potrebbe rompere l'here-string: ${l}`,
    );
  }
}

test("meshagent choco: pacchetto domarc-meshagent, pack+install, agent configurato", () => {
  const s = buildMeshAgentChocoScript(
    42,
    "https://da-ipam.example.it:4443",
    "mesh//AbC123==",
  );
  assert.ok(s.includes("<id>domarc-meshagent</id>"), "nuspec con id pacchetto");
  assert.ok(s.includes("choco pack"), "costruisce il .nupkg");
  assert.ok(s.includes("choco install $pkgId --source"), "installa dalla cartella locale");
  assert.ok(s.includes("/meshagents?id=3"), "download agente Windows x64");
  // /meshsettings vuole l'id SENZA prefisso mesh//.
  assert.ok(s.includes("/meshsettings?id=AbC123=="), "msh id nudo");
  assert.ok(!s.includes("?id=mesh//"), "il prefisso mesh// non deve finire in ?id=");
  assert.ok(s.includes("--copy-msh=1"), "il .msh va copiato o l'agente non si connette");
  assert.ok(s.includes("-fulluninstall"), "chocolateyUninstall rimuove l'agente");
  assert.ok(s.includes("EXIT_CODE="), "emette EXIT_CODE per il parser dell'executor");
  assertNoStrayHereStringClose(s);
});

test("glpi choco: pacchetto domarc-glpi-agent, MSI + push task configurati", () => {
  const s = buildGlpiAgentChocoScript(7, {
    ingestUrl: "https://da-ipam.example.it/api/inventory/ingest",
    ingestToken: "tok-secret-123",
    intervalHours: 6,
    msiUrl: "https://x/GLPI-Agent-1.2-x64.msi",
    msiVersion: "1.2",
    pushScriptBody: "param([string]$IngestUrl,[string]$IngestToken)\nWrite-Host ok",
  });
  assert.ok(s.includes("<id>domarc-glpi-agent</id>"), "nuspec con id pacchetto");
  assert.ok(s.includes("choco pack"));
  assert.ok(s.includes("choco install $pkgId --source"));
  assert.ok(s.includes("https://da-ipam.example.it/api/inventory/ingest"), "URL ingest embedded");
  assert.ok(s.includes("tok-secret-123"), "token embedded");
  assert.ok(s.includes("msiexec"), "installa l'MSI GLPI");
  assert.ok(s.includes("Register-ScheduledTask"), "registra il task di push");
  assert.ok(s.includes("Unregister-ScheduledTask"), "uninstall rimuove il task");
  assertNoStrayHereStringClose(s);
});

test("gli id pacchetto sono esposti", () => {
  assert.equal(CHOCO_PACKAGE_IDS.meshagent, "domarc-meshagent");
  assert.equal(CHOCO_PACKAGE_IDS.glpiAgent, "domarc-glpi-agent");
});

test("una config con apice singolo non rompe il literal PS del push body", () => {
  // Il push body finisce in un literal single-quoted: gli apici vanno raddoppiati.
  const s = buildGlpiAgentChocoScript(1, {
    ingestUrl: "https://x/api/inventory/ingest",
    ingestToken: "t",
    intervalHours: 6,
    msiUrl: "https://x/a.msi",
    msiVersion: "1.0",
    pushScriptBody: "Write-Host 'ciao'",
  });
  assert.ok(s.includes("Write-Host ''ciao''"), "apici raddoppiati nel literal PS");
});
