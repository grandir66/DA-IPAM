#!/usr/bin/env node
/**
 * Dopo `npm run build` (postbuild): nessuna rotta deve tracciare file della cartella dati.
 *
 * Perché (27/10/2026): con Next 16.4 Turbopack legge ogni file che le rotte tracciano.
 * Un `path.join(…)` scritto nel modulo, o un `fs.existsSync(ambiente || "/assoluto")`,
 * diventano un glob su tutto il progetto che prende `data/` (database dei clienti e
 * copie): sull'hub, 54 GB, la build è morta per memoria anche con 20 GB di RAM. La
 * regola sta in src/lib/percorsi.ts; questo controllo ferma la build se torna, con le
 * rotte colpevoli, invece di scoprirlo dall'OOM sull'hub.
 *
 * Esce 1 se un `.nft.json` elenca file sotto `<cwd>/data/` (o `DA_INVENT_DATA_DIR`),
 * o se la cartella della build non c'è: un controllo che non trova niente da guardare
 * non passa per buono.
 */
import fs from "node:fs";
import path from "node:path";

/** La stessa scelta di next.config.ts (cartellaBuild): ambiente, poi `.next-attiva`, poi `.next`. */
function cartellaBuild() {
  const daAmbiente = process.env.DA_INVENT_BUILD_DIR?.trim();
  if (daAmbiente) return daAmbiente;
  try {
    const attiva = fs.readFileSync(path.join(process.cwd(), ".next-attiva"), "utf8").trim();
    if (/^\.next-[ab]$/.test(attiva)) return attiva;
  } catch {
    // nessun file: la cartella storica
  }
  return ".next";
}

function* fileNft(cartella) {
  for (const voce of fs.readdirSync(cartella, { withFileTypes: true })) {
    const pieno = path.join(cartella, voce.name);
    if (voce.isDirectory()) yield* fileNft(pieno);
    else if (voce.name.endsWith(".nft.json")) yield pieno;
  }
}

const build = path.resolve(cartellaBuild());
if (!fs.existsSync(build)) {
  console.error(`controlla-tracciamento: cartella della build assente (${build}).`);
  process.exit(1);
}

const cartelleDati = [path.resolve("data")];
const daAmbiente = process.env.DA_INVENT_DATA_DIR?.trim();
if (daAmbiente) cartelleDati.push(path.resolve(daAmbiente));
const dentroDati = (f) => cartelleDati.some((d) => f === d || f.startsWith(d + path.sep));

let guardati = 0;
const colpevoli = new Map();
for (const nft of fileNft(build)) {
  guardati++;
  const { files = [] } = JSON.parse(fs.readFileSync(nft, "utf8"));
  const dati = files.map((f) => path.resolve(path.dirname(nft), f)).filter(dentroDati);
  if (dati.length) colpevoli.set(path.relative(build, nft), dati);
}

if (guardati === 0) {
  console.error(`controlla-tracciamento: nessun .nft.json in ${build}.`);
  process.exit(1);
}
if (colpevoli.size) {
  console.error(
    `controlla-tracciamento: ${colpevoli.size} rotte su ${guardati} tracciano la cartella dati. ` +
      "Turbopack legge quei file in build (con i dati veri va fuori memoria): vedi src/lib/percorsi.ts.",
  );
  for (const [nft, dati] of [...colpevoli].slice(0, 10)) {
    console.error(`  ${nft}: ${dati.slice(0, 3).map((f) => path.relative(process.cwd(), f)).join(", ")}${dati.length > 3 ? ` (+${dati.length - 3})` : ""}`);
  }
  process.exit(1);
}
console.log(`controlla-tracciamento: ${guardati} file di tracciamento, nessuno nella cartella dati.`);
