/**
 * Le scritture di `dati/vault_kdbx/contenuto.json`, uguali a quelle della prova di DA-Link
 * (`tests/aiuti_vault_kdbx.py`). Lanciato da solo rigenera `da-typescript.kdbx` + `da-typescript.keyx`
 * (valori finti) nella cartella passata:
 *
 *   node --import tsx src/lib/vault/__tests__/support/kdbx-contenuto.ts <cartella>
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArchivioKdbx, creaArchivioKdbx } from "../../kdbx";

export interface Contenuto {
  metadati: Record<string, string>;
  scritture: Array<[string, Record<string, string>]>;
  voci: Record<string, { valori: Record<string, string>; versione: number; storico: Array<Record<string, string>> }>;
}

export function scriviContenuto(a: ArchivioKdbx, contenuto: Contenuto): void {
  for (const [percorso, valori] of contenuto.scritture) a.scrivi(percorso, valori);
}

async function genera(uscita: string): Promise<void> {
  const contenuto = JSON.parse(readFileSync(join(__dirname, "..", "dati", "vault_kdbx", "contenuto.json"), "utf8")) as Contenuto;
  const tmp = join(mkdtempSync(join(uscita, "tmp-")), "v");
  const keyfile = await creaArchivioKdbx(tmp, "prova");
  const a = await ArchivioKdbx.apri(tmp, "prova", keyfile, { scrittura: true });
  scriviContenuto(a, contenuto);
  await a.salva();
  a.chiudi();
  writeFileSync(join(uscita, "da-typescript.kdbx"), readFileSync(join(tmp, "prova.kdbx")));
  writeFileSync(join(uscita, "da-typescript.keyx"), keyfile);
}

if (require.main === module) {
  const uscita = process.argv[2];
  if (!uscita) throw new Error("serve la cartella di uscita");
  genera(uscita).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
