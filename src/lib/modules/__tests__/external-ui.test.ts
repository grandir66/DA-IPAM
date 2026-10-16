import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { externalUiText } from "@/lib/modules/external-ui";

/**
 * UI-24 (piano di miglioramento, tappa 1, 2026-10-12). Nella griglia dei moduli
 * il secondo pulsante, quello che apre l'interfaccia web propria di un modulo,
 * diceva sempre «Interfaccia edge — scan, reti, Greenbone», anche sul riquadro
 * di MeshCentral, dove apre la console di MeshCentral. L'etichetta ora dipende
 * dal modulo: dice cosa si apre.
 */

test("il pulsante esterno di MeshCentral dice che apre la console di MeshCentral", () => {
  const t = externalUiText("meshcentral", "MeshCentral");
  assert.match(t.label, /MeshCentral/);
  assert.match(t.title, /MeshCentral/);
  assert.doesNotMatch(`${t.label} ${t.title}`, /edge|Greenbone|scan/i);
});

test("il pulsante esterno dello Scanner-Edge apre l'interfaccia dell'edge", () => {
  const t = externalUiText("edge", "Scanner-Edge");
  assert.match(t.label, /edge/i);
  assert.match(t.title, /Greenbone/);
});

test("un modulo senza testo dedicato non si spaccia per l'edge", () => {
  const t = externalUiText("librenms", "LibreNMS");
  assert.match(t.label, /LibreNMS/);
  assert.doesNotMatch(`${t.label} ${t.title}`, /edge|Greenbone/i);
});

test("la griglia dei moduli non scrive a mano il testo del pulsante esterno", () => {
  const grid = fs.readFileSync(path.join(process.cwd(), "src/app/(dashboard)/launchpad/modules-grid.tsx"), "utf8");
  assert.doesNotMatch(grid, /Interfaccia edge|Greenbone/, "testo fisso dell'edge nella griglia");
  assert.match(grid, /externalUiText\(/, "la griglia deve chiedere il testo a externalUiText");
});
