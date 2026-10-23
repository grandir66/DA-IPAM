/**
 * L'archivio del vault nel backup notturno (piano da-vault 2026-10-23, prova «backup coerente con gli slot»).
 *
 * Dopo la ricifra i database si aprono solo con la chiave degli slot: un backup dei soli database non si ripristina.
 * Col vault acceso (`runHubBackup`) si copiano anche i file dell'archivio, già cifrati (passphrase del cliente, chiave
 * Domarc, TPM della macchina): copiarli non espone la chiave dei dati. Niente file temporanei.
 */
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FILE_ARCHIVIO = ["archivio.json", "slot-cliente.age", "slot-domarc.age", "slot-tpm.cred", "segreti.json", "recuperi.jsonl"];

export interface CopiaArchivio {
  source: string;
  output: string;
  size_bytes: number;
  sha256: string;
  ok: boolean;
  error?: string;
}

/** Copia i file dell'archivio in `<outDir>/vault/`; [] se l'archivio non c'è. */
export function copiaArchivioVault(cartellaArchivio: string, outDir: string): CopiaArchivio[] {
  if (!existsSync(join(cartellaArchivio, "archivio.json"))) return [];
  const dest = join(outDir, "vault");
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  const voci: CopiaArchivio[] = [];
  for (const nome of FILE_ARCHIVIO) {
    const source = join(cartellaArchivio, nome);
    if (!existsSync(source)) continue;
    const output = join(dest, nome);
    try {
      copyFileSync(source, output);
      const dati = readFileSync(output);
      // copyFileSync tiene i permessi della sorgente: si fissano a 0600 qualunque fossero.
      chmodSync(output, 0o600);
      voci.push({ source, output, size_bytes: dati.length, sha256: createHash("sha256").update(dati).digest("hex"), ok: true });
    } catch (e) {
      voci.push({ source, output, size_bytes: 0, sha256: "", ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return voci;
}
