/**
 * `stati_componenti` del segnale quando trasmette DA-IPAM su una base modulare (19/10).
 *
 * Sulla base modulare di Deploy-Appliance trasmette UN mittente alla volta: con IPAM
 * spento la base (`scripts/segnale-base.py`), con IPAM acceso questo job. DA-Link tiene
 * una sola riga per oggetto: senza questo campo, con IPAM acceso, la pagina mostrava
 * l'ultima fotografia della base («ipam disattivato») con la sua data.
 *
 * Stesse regole della base, che qui si ripetono:
 * - solo sulle basi modulari (file `modular-v1`): le appliance legacy omettono il campo;
 * - `operativo` dell'Edge solo da container healthy, mai dal file-segno della fase;
 * - Docker che non risponde = edge omesso (non so), mai «spento» o «errore» inventato;
 * - IPAM è `operativo`: questo codice gira dentro il suo servizio;
 * - MeshCentral (terzo modulo, 19/10): container `meshcentral`; senza healthcheck vale la
 *   risposta vera della sua UI su 127.0.0.1:4443 (codice < 400), mai il file-segno.
 *
 * Contratto: DA-Link `docs/api-stato-sistema.md`.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

export const MODULI_DIR = "/etc/da-appliance/modules";

export type StatoComponente =
  | "predisposto"
  | "disattivato"
  | "dati_da_scaricare"
  | "inizializzazione"
  | "operativo"
  | "errore";

export type StatiComponenti = Record<string, { stato: StatoComponente }>;

export interface EsitoComando {
  codice: number;
  stdout: string;
  stderr: string;
}

export interface DipendenzeStati {
  esiste: (percorso: string) => boolean;
  leggi: (percorso: string) => string;
  docker: (argomenti: string[]) => Promise<EsitoComando>;
  /** La UI di MeshCentral risponde in locale con un codice < 400 (come `curl -f`). */
  risponde4443: () => Promise<boolean>;
}

export const dipendenzeStatiReali: DipendenzeStati = {
  esiste: (p) => fs.existsSync(p),
  leggi: (p) => fs.readFileSync(p, "utf8"),
  docker: (argomenti) =>
    new Promise((resolve) => {
      execFile("docker", argomenti, { timeout: 10_000, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
        const codice = err ? (typeof err.code === "number" ? err.code : 124) : 0;
        resolve({ codice, stdout: String(stdout ?? ""), stderr: String(stderr ?? err?.message ?? "") });
      });
    }),
  // Prova locale senza dati: il certificato di MeshCentral è suo, autofirmato.
  risponde4443: () =>
    new Promise((resolve) => {
      const req = https.get(
        { host: "127.0.0.1", port: 4443, path: "/", rejectUnauthorized: false, timeout: 5000 },
        (res) => {
          res.resume();
          resolve((res.statusCode ?? 500) < 400);
        },
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve(false));
    }),
};

/** Stato dell'Edge, o null se non si sa (Docker muto) o se l'Edge non è mai stato predisposto. */
export async function statoEdge(dip: DipendenzeStati): Promise<StatoComponente | null> {
  let fase: string | null = null;
  try {
    fase = dip.leggi(path.join(MODULI_DIR, "edge.state")).trim();
  } catch {
    fase = null;
  }
  const r = await dip.docker([
    "inspect",
    "--format",
    "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}",
    "appliance-edge",
  ]);
  if (r.codice !== 0 && !/no such/i.test(r.stderr)) return null;
  const [statoC, saluteC] = (r.codice === 0 ? r.stdout.trim() : "").split("|");
  if (statoC === "restarting") return "errore";
  if (statoC === "running") {
    if (saluteC === "healthy") return "operativo";
    if (saluteC === "unhealthy") return "errore";
    return "inizializzazione";
  }
  if (fase === "dati_da_scaricare" || fase === "disattivato") return fase;
  if (fase === "inizializzazione" && !statoC) return "inizializzazione";
  if (fase === null || fase === "") return null;
  return "errore";
}

/** Stato di MeshCentral, o null se non si sa o se il modulo non è mai stato predisposto. */
export async function statoMeshcentral(dip: DipendenzeStati): Promise<StatoComponente | null> {
  let fase: string | null = null;
  try {
    fase = dip.leggi(path.join(MODULI_DIR, "meshcentral.state")).trim();
  } catch {
    fase = null;
  }
  const r = await dip.docker([
    "inspect",
    "--format",
    "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}",
    "meshcentral",
  ]);
  if (r.codice !== 0 && !/no such/i.test(r.stderr)) return null;
  const [statoC, saluteC] = (r.codice === 0 ? r.stdout.trim() : "").split("|");
  if (statoC === "restarting") return "errore";
  if (statoC === "running") {
    if (saluteC) return saluteC === "healthy" ? "operativo" : saluteC === "unhealthy" ? "errore" : "inizializzazione";
    if (await dip.risponde4443()) return "operativo";
    return fase === "inizializzazione" || fase === null || fase === "" ? "inizializzazione" : "errore";
  }
  if (fase === "disattivato") return "disattivato";
  if (fase === "inizializzazione" && !statoC) return "inizializzazione";
  if (fase === null || fase === "") return null;
  return "errore";
}

/** Null fuori dalle basi modulari: il campo non si manda e DA-Link conserva ciò che ha. */
export async function statiComponentiBase(
  dip: DipendenzeStati = dipendenzeStatiReali,
): Promise<StatiComponenti | null> {
  let modulare = false;
  try {
    modulare = dip.esiste(path.join(MODULI_DIR, "modular-v1"));
  } catch {
    modulare = false;
  }
  if (!modulare) return null;
  const stati: StatiComponenti = { ipam: { stato: "operativo" } };
  try {
    const edge = await statoEdge(dip);
    if (edge) stati.edge = { stato: edge };
  } catch {
    // Un guasto nel leggere l'Edge non toglie il resto: l'Edge resta «non so».
  }
  try {
    const mesh = await statoMeshcentral(dip);
    if (mesh) stati.meshcentral = { stato: mesh };
  } catch {
    // Come per l'Edge: MeshCentral resta «non so».
  }
  return stati;
}
