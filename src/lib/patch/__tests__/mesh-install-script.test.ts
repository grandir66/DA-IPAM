import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMeshAgentInstallScript } from "@/lib/patch/ps-scripts";
import { buildMeshInstallScript } from "@/lib/integrations/meshcentral/install-scripts";

test("embeds serverUrl + meshId, fixed service name, idempotency marker, EXIT_CODE", () => {
  const s = buildMeshAgentInstallScript(42, "https://da-ipam.example.com", "mesh//AbC123==");
  assert.ok(s.includes("https://da-ipam.example.com/meshsettings?id=AbC123=="));
  assert.ok(s.includes("https://da-ipam.example.com/meshagents?id="));
  assert.ok(s.includes("Mesh Agent"), "fixed service name");
  assert.ok(s.includes("MESHAGENT_ALREADY_INSTALLED_AND_RUNNING"), "idempotency marker");
  assert.ok(s.includes("MESHAGENT_INSTALLED_AND_RUNNING"), "success marker");
  assert.ok(/EXIT_CODE=/.test(s), "exit code line");
  assert.ok(s.includes("op-42") || s.includes("42"), "operation log path");
});

// I due generatori di script Windows (push WinRM e download dalla UI) devono
// concordare sui flag che decidono se l'agente si connette davvero. Sono nati
// come copie l'una dell'altra e sono divergiuti TRE volte, ogni volta con un bug
// invisibile finche' non si provava su un host vero (2026-07-15/17):
//   - prefisso mesh// nel parametro ?id=  -> 401
//   - bypass TLS assente nel push         -> download dell'agente fallito
//   - --copy-msh=1 assente nel push       -> agente installato che non si connette
// Questi test bloccano la quarta.
test("push e UI concordano sui flag critici di installazione", () => {
  const push = buildMeshAgentInstallScript(1, "https://mesh.example.com", "mesh//AbC123==");
  const ui = buildMeshInstallScript("windows", {
    serverUrl: "https://mesh.example.com",
    meshId: "mesh//AbC123==",
  });
  for (const [label, s] of [["push", push], ["ui", ui]] as const) {
    // NB: si asserisce sulla RIGA DI COMANDO, non su `includes("--copy-msh=1")`.
    // Un semplice includes passava anche col flag rimosso, perche' la stringa
    // compariva in un commento dentro lo script generato: il test era cieco
    // proprio verso il bug che doveva impedire.
    const invocation = /^&\s+\$[Ee]xe\s+-fullinstall\b[^\n]*--copy-msh=1/m;
    assert.match(
      s,
      invocation,
      `${label}: --copy-msh=1 deve stare sulla riga di -fullinstall, altrimenti l'agente si installa ma non si connette mai (falso positivo silenzioso)`,
    );
    assert.ok(
      s.includes("/meshsettings?id=AbC123=="),
      `${label}: il parametro ?id= vuole il mesh id senza prefisso mesh// (altrimenti 401)`,
    );
    assert.ok(
      !s.includes("?id=mesh//"),
      `${label}: il prefisso mesh// non deve MAI finire in ?id=`,
    );
    assert.ok(
      s.includes("ServerCertificateValidationCallback") || s.includes("CertificatePolicy"),
      `${label}: manca il bypass TLS per il cert self-signed di MeshCentral`,
    );
  }
});

test("bypassa la validazione TLS: MeshCentral ha un cert self-signed", () => {
  // REGRESSIONE (2026-07-17). Il push WinRM falliva sul target reale con
  //   ERROR: Download failed: Impossibile stabilire una relazione di trust
  //   per il canale sicuro SSL/TLS
  // perche' questo script impostava solo SecurityProtocol (TLS 1.2) senza il
  // ServerCertificateValidationCallback. Lo script generato dalla UI
  // (install-scripts.ts) lo faceva gia': i due percorsi erano divergenti e solo
  // quello via push era rotto. Finche' MeshCentral usa un cert self-signed i due
  // devono restare allineati.
  const s = buildMeshAgentInstallScript(1, "https://mesh.example.com", "mesh//AAA");
  assert.ok(
    s.includes("ServerCertificateValidationCallback"),
    "senza il callback il download dell'agente fallisce sul cert self-signed",
  );
  assert.ok(
    s.includes("DA_IPAM_INSECURE_SSL"),
    "stesso escape hatch dello script UI: DA_IPAM_INSECURE_SSL=0 ripristina la validazione",
  );
});

test("single quotes in serverUrl/meshId are PS-escaped (doubled)", () => {
  const s = buildMeshAgentInstallScript(1, "https://h'x", "m'y");
  assert.ok(s.includes("https://h''x"), "serverUrl not psQuoted");
  assert.ok(s.includes("m''y"), "meshId not psQuoted");
});
