/**
 * Processo figlio della prova del crash (kdbx.test.ts): apre l'archivio, scrive una voce e muore a metà del
 * salvataggio con exit 9. Niente gancio nel codice: si sostituiscono `fs.fsyncSync` («a_meta_scrittura», il file
 * temporaneo è scritto ma non ancora a posto) o `fs.renameSync` verso `prova.kdbx` («prima_del_rename»).
 */
import fs from "node:fs";
import { join } from "node:path";

const [cartella, punto] = process.argv.slice(2);
const veroRename = fs.renameSync;
const veroFsync = fs.fsyncSync;
fs.renameSync = (a: fs.PathLike, b: fs.PathLike): void => {
  if (punto === "prima_del_rename" && String(b).endsWith("prova.kdbx")) process.exit(9);
  veroRename(a, b);
};
fs.fsyncSync = (fd: number): void => {
  if (punto === "a_meta_scrittura") process.exit(9);
  veroFsync(fd);
};

async function main(): Promise<void> {
  const { ArchivioKdbx } = await import("../../kdbx");
  const keyfile = new Uint8Array(fs.readFileSync(join(cartella, "prova.keyx")));
  const a = await ArchivioKdbx.apri(cartella, "prova", keyfile, { scrittura: true });
  a.scrivi("clienti/70000/firewall/ssh", { password: "PW-FINTA-NUOVA" });
  await a.salva();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
