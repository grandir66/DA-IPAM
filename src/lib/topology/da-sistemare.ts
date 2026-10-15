/**
 * Il motivo di «Da sistemare» per un oggetto senza prove di ruolo (spec topologia §13.8.2), in parole: chi guarda capisce
 * perché non è nell'albero e come rimetterlo. Fuori da cavi/ perché nomina i protocolli (prova I37).
 */
import type { MapNode } from "@/lib/topology/model-types";

const TIPO: Readonly<Record<string, string>> = { router: "router", firewall: "firewall", switch: "switch", access_point: "access point" };
const NESSUNA = "ma nessuna prova che lo sia: non vede vicini (LLDP, CDP, MNDP), nessuna porta con spanning tree, nessun apparato dietro le sue porte";

export function motivoDaSistemare(n: Pick<MapNode, "kind" | "type">): string {
  const tipo = TIPO[n.type] ?? n.type;
  return n.kind === "device"
    ? `dichiarato ${tipo}, ${NESSUNA}. Se lo è: Ruolo nella mappa → Apparato di rete`
    : `la classificazione automatica lo dice ${tipo}, ${NESSUNA}. Se lo è: prima Promuovi ad apparato, poi Ruolo nella mappa → Apparato di rete`;
}
