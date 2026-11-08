/**
 * Freno della cifratura per l'installazione «tecnico» (ADR 0037). La cartella dati deve stare
 * su un volume cifrato: Linux = un antenato di tipo `crypt` (LUKS sulla radice o contenitore
 * LUKS a file montato sulla cartella dati), macOS = FileVault acceso. Un controllo che non sa
 * rispondere dà `non_so`, e `server.ts` non parte: freno chiuso.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type EsitoCifratura =
  | { stato: "cifrato"; come: string }
  | { stato: "in_chiaro"; come: string }
  | { stato: "non_so"; motivo: string };

type Esegui = (cmd: string, args: string[]) => string;

const eseguiVero: Esegui = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });

/** La prima cartella esistente risalendo da `dir` (alla prima installazione la cartella dati può non esserci). */
function cartellaEsistente(dir: string): string {
  let d = path.resolve(dir);
  while (!fs.existsSync(d)) {
    const su = path.dirname(d);
    if (su === d) break;
    d = su;
  }
  return d;
}

export function cifraturaCartella(
  dir: string,
  opz: { piattaforma?: NodeJS.Platform; esegui?: Esegui } = {},
): EsitoCifratura {
  const piattaforma = opz.piattaforma ?? process.platform;
  const esegui = opz.esegui ?? eseguiVero;

  if (piattaforma === "darwin") {
    let out: string;
    try { out = esegui("fdesetup", ["status"]); } catch { return { stato: "non_so", motivo: "fdesetup status non risponde" }; }
    if (/FileVault is On\./.test(out)) return { stato: "cifrato", come: "FileVault acceso" };
    if (/FileVault is Off\./.test(out)) return { stato: "in_chiaro", come: "FileVault spento" };
    return { stato: "non_so", motivo: `fdesetup status: «${out.trim().slice(0, 80)}»` };
  }

  if (piattaforma !== "linux") return { stato: "non_so", motivo: `sistema ${piattaforma} non controllato` };

  const cartella = cartellaEsistente(dir);
  let sorgente: string;
  try {
    sorgente = esegui("findmnt", ["-no", "SOURCE", "--target", cartella]).trim().split("\n")[0].replace(/\[.*\]$/, "");
  } catch {
    return { stato: "non_so", motivo: `findmnt non risponde per ${cartella}` };
  }
  if (!sorgente.startsWith("/dev/")) {
    return { stato: "non_so", motivo: `la cartella dati non sta su un dispositivo a blocchi (${sorgente || "nessuna sorgente"})` };
  }
  let tipi: string[];
  try {
    tipi = esegui("lsblk", ["-s", "-r", "-n", "-o", "TYPE", sorgente]).split("\n").map((t) => t.trim()).filter(Boolean);
  } catch {
    return { stato: "non_so", motivo: `lsblk non risponde per ${sorgente}` };
  }
  if (tipi.length === 0) return { stato: "non_so", motivo: `lsblk non elenca ${sorgente}` };
  const catena = `${sorgente} (${tipi.join(" → ")})`;
  return tipi.includes("crypt") ? { stato: "cifrato", come: catena } : { stato: "in_chiaro", come: catena };
}
