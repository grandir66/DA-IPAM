/**
 * «Azzera l'appliance» (Riccardo, 29/10/2026): su un'appliance da immagine DA-IPAM lancia
 * `da-appliance azzera` di Deploy-Appliance (primo-avvio/azzera.sh), che riporta la VM allo
 * stato dell'immagine (via cliente, voci, database, password, identità, NetBird e rete; restano
 * sistema, programmi e Greenbone) e la spegne. Si prepara così in laboratorio una macchina da
 * portare dal cliente; lì il comando di DA-Link (Nuova appliance → «Riusa una macchina già
 * installata») la riconfigura col cliente, il nome e l'IP nuovi.
 *
 * Il lavoro lo fa un'unità di systemd a parte (`da-azzera`): ferma anche DA-IPAM, e non deve
 * morire con lui. Il sì è il nome dell'appliance scritto per intero, come sul terminale.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { esiste, unisci } from "./percorsi";

export interface StatoAzzeramento {
  /** L'appliance sa azzerarsi (immagine con azzera.sh). */
  disponibile: boolean;
  /** Perché no, in italiano (vuoto se disponibile). */
  motivo: string;
  /** Il nome da scrivere per confermare (il nodo), null se non si legge. */
  nome: string | null;
  /** La versione dell'immagine, null se non è un'appliance da immagine. */
  immagine: string | null;
}

export interface PercorsiAppliance {
  conf: string;
  azzera: string;
}

export function percorsiAppliance(env: Readonly<Record<string, string | undefined>> = process.env): PercorsiAppliance {
  return {
    conf: env.DA_APPLIANCE_CONF?.trim() || "/etc/da-appliance",
    azzera: env.DA_APPLIANCE_AZZERA?.trim() || "/opt/deploy-appliance/primo-avvio/azzera.sh",
  };
}

const NOME = /^[a-z0-9][a-z0-9-]{0,62}$/;

function leggiJson(file: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function statoAzzeramento(p: PercorsiAppliance = percorsiAppliance(), host: () => string = os.hostname): StatoAzzeramento {
  const versione = leggiJson(unisci(p.conf, "versione.json"));
  const immagine = typeof versione?.versione === "string" ? versione.versione : null;
  const voluto = leggiJson(unisci(p.conf, "stato-voluto.yaml"));
  const daVoluto = typeof voluto?.nome === "string" ? voluto.nome : "";
  const candidato = daVoluto || host();
  const nome = NOME.test(candidato) ? candidato : null;
  if (immagine === null) {
    return { disponibile: false, motivo: "non è un'appliance da immagine: l'azzeramento vale solo lì", nome, immagine };
  }
  if (!esiste(p.azzera)) {
    return {
      disponibile: false,
      motivo: `l'immagine ${immagine} non sa ancora azzerarsi: prima «Aggiorna» dalla scheda dell'appliance in DA-Link`,
      nome,
      immagine,
    };
  }
  if (nome === null) return { disponibile: false, motivo: "il nome dell'appliance non si legge", nome, immagine };
  return { disponibile: true, motivo: "", nome, immagine };
}

export type EseguiComando = (cmd: string, args: string[]) => Promise<{ codice: number; stderr: string }>;

const esegui: EseguiComando = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15_000 }, (err, _stdout, stderr) => {
      if (!err) return resolve({ codice: 0, stderr: "" });
      resolve({ codice: typeof err.code === "number" ? err.code : -1, stderr: (stderr || err.message).trim() });
    });
  });

/** systemd-run, senza shell: il nome è già controllato (NOME) e va come argomento a sé. */
export function argomentiAzzeramento(azzera: string, nome: string): string[] {
  return ["--unit=da-azzera", "--collect", "--no-block", "--", "/bin/bash", azzera, "--conferma", nome, "--spegni"];
}

export type EsitoAzzeramento = { ok: true } | { ok: false; errore: string; stato: number };

export async function avviaAzzeramento(
  conferma: string,
  p: PercorsiAppliance = percorsiAppliance(),
  run: EseguiComando = esegui,
  host: () => string = os.hostname,
): Promise<EsitoAzzeramento> {
  const s = statoAzzeramento(p, host);
  if (!s.disponibile || s.nome === null) return { ok: false, errore: s.motivo, stato: 409 };
  if (conferma.trim() !== s.nome) {
    return { ok: false, errore: `per azzerare scrivi il nome dell'appliance: ${s.nome}`, stato: 400 };
  }
  const { codice, stderr } = await run("systemd-run", argomentiAzzeramento(p.azzera, s.nome));
  if (codice !== 0) {
    return { ok: false, errore: `azzeramento non avviato (systemd-run, codice ${codice}): ${stderr || "nessun dettaglio"}`, stato: 500 };
  }
  return { ok: true };
}
