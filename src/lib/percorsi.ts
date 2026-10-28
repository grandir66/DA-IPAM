import fs from "node:fs";
import path from "node:path";

/**
 * `path.join` e `path.resolve` per il codice del server, in un modulo a parte.
 *
 * Perché (27/10/2026): Turbopack 16.4 legge ogni `path.join(…)`/`path.resolve(…)`
 * scritto direttamente in un modulo e ne fa un riferimento a file da tracciare: con
 * un pezzo fisso e uno variabile (`path.join(dir, "tenants", `${codice}.db`)`, ma
 * anche `path.join(os.tmpdir(), `${x}.db`)`) diventa un glob su tutto il progetto, che
 * prende `data/` con i database dei clienti e le copie. La build li legge: sull'hub,
 * con 54 GB di dati, è morta per memoria anche con 20 GB di RAM. `turbopackIgnore`
 * su `process.cwd()` non basta, perché il glob nasce anche da un prefisso ignoto.
 * Passando dagli argomenti di una funzione di un altro modulo l'analisi non vede
 * i pezzi e non crea riferimenti (prova in docs/proposte/2026-10-27-next-16-4-build-memoria.md).
 *
 * Regola: nel codice di `src/` niente `path.join`/`path.resolve` diretti, si usano
 * queste due (la ferma ESLint, `no-restricted-syntax` in eslint.config.mjs).
 */
export function unisci(...parti: string[]): string {
  return path.join(...parti);
}

export function risolvi(...parti: string[]): string {
  return path.resolve(...parti);
}

/**
 * `fs.existsSync` per lo stesso motivo (28/10): `existsSync(ambiente || "/run/…")` scritto
 * nel modulo diventava un glob e la build tracciava `data/` (sonda trunk del wizard).
 */
export function esiste(percorso: string): boolean {
  return fs.existsSync(percorso);
}
