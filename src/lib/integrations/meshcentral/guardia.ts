/**
 * Guardia del modulo MeshCentral per le rotte d'azione (SEC-18, T3-28).
 *
 * Va chiamata dopo l'autenticazione, dentro withTenantFromSession: a modulo
 * spento la rotta risponde 409 prima di toccare configurazione, nodi o server.
 * L'elenco delle rotte che la devono chiamare sta nella prova
 * `__tests__/disinstallato.test.ts`.
 */
import { NextResponse } from "next/server";
import { meshAttivo, MESH_DISATTIVATO } from "./feature";

export function guardiaMesh(): NextResponse | null {
  if (meshAttivo()) return null;
  return NextResponse.json({ error: MESH_DISATTIVATO }, { status: 409 });
}
