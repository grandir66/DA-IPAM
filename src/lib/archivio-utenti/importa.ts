/**
 * Importa un file `.kdbx` di KeePass nell'archivio degli utenti (ADR 0043). Il file si apre in memoria con la sua
 * password, che si usa e si dimentica: non si scrive da nessuna parte. Le voci finiscono sotto il gruppo
 * `importati/…`, con gli stessi gruppi che avevano; il cestino del file non si importa.
 */
import * as kdbxweb from "kdbxweb";
import { collegaArgon2 } from "../vault/keepass";
import type { Esito, Persona } from "./motore";
import { scriviMolte, type VoceDaImportare } from "./voci";

export const IMPORTA_MAX_BYTE = 5 * 1024 * 1024;
export const IMPORTA_MAX_VOCI = 2000;
const STANDARD: Readonly<Record<string, string>> = { UserName: "username", Password: "password", URL: "url", Notes: "notes" };

const testo = (v: unknown): string => (v instanceof kdbxweb.ProtectedValue ? v.getText() : typeof v === "string" ? v : "");
/** Un nome di campo di KeePass («Codice PIN») nel formato dell'archivio (`codice-pin`); vuoto se non resta niente. */
function nomeCampo(nome: string): string {
  return nome.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

/** Legge le voci di un file KDBX: modulo puro rispetto al disco (lavora sui byte dati). Lancia se la password non apre. */
export async function leggiKdbx(dati: Uint8Array, password: string): Promise<VoceDaImportare[]> {
  collegaArgon2();
  let db: kdbxweb.Kdbx;
  try {
    db = await kdbxweb.Kdbx.load(dati.buffer.slice(dati.byteOffset, dati.byteOffset + dati.byteLength) as ArrayBuffer, new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(password)));
  } catch (e) {
    throw new Error(e instanceof kdbxweb.KdbxError && e.code === kdbxweb.Consts.ErrorCodes.InvalidKey ? "La password non apre questo file" : "Il file non è un archivio KeePass leggibile (serve un KDBX senza key file)");
  }
  const cestino = db.meta.recycleBinUuid;
  const voci: VoceDaImportare[] = [];
  const scendi = (g: kdbxweb.KdbxGroup, percorso: string[]): void => {
    if (cestino && g.uuid.equals(cestino)) return;
    for (const e of g.entries) {
      if (voci.length >= IMPORTA_MAX_VOCI) return;
      const valori: Record<string, string> = {};
      for (const [campo, v] of e.fields) {
        if (campo === "Title") continue;
        const nome = STANDARD[campo] ?? nomeCampo(campo);
        const valore = testo(v);
        if (nome && valore && nome !== "titolo") valori[nome] = valore.slice(0, campo === "Notes" ? 4000 : 2000);
      }
      voci.push({ gruppo: ["importati", ...percorso].join("/"), titolo: testo(e.fields.get("Title")) || "senza titolo", valori });
    }
    for (const figlio of g.groups) scendi(figlio, [...percorso, figlio.name ?? "gruppo"]);
  };
  // Il gruppo radice di KeePass porta il nome del file: non diventa un gruppo.
  scendi(db.getDefaultGroup(), []);
  return voci;
}

export async function importaKdbx(chi: Persona, op: { dati: Uint8Array; password: string; indirizzo?: string | null }): Promise<Esito<{ scritte: number; troncato: boolean }>> {
  if (op.dati.length === 0 || op.dati.length > IMPORTA_MAX_BYTE) return { ok: false, stato: 400, errore: "Il file è vuoto o supera i 5 MB" };
  let voci: VoceDaImportare[];
  try {
    voci = await leggiKdbx(op.dati, op.password);
  } catch (e) {
    return { ok: false, stato: 400, errore: e instanceof Error ? e.message : "File non leggibile" };
  }
  const r = await scriviMolte(chi, voci, { indirizzo: op.indirizzo });
  return r.ok ? { ok: true, scritte: r.scritte, troncato: voci.length >= IMPORTA_MAX_VOCI } : r;
}
