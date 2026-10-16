import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Cartella del build. scripts/update.sh costruisce nella cartella NON in uso
 * (.next-a o .next-b, con DA_INVENT_BUILD_DIR) e, a build riuscito, scrive il
 * suo nome in `.next-attiva`: il processo acceso non perde i suoi file durante
 * il build, e tornare indietro è riscrivere quel file (16/10/2026).
 * Next scrive la cartella dentro le rotte compilate, quindi la stessa cartella
 * deve valere al build e all'avvio: per questo non si rinomina dopo il build.
 * Senza `.next-attiva` (sviluppo, Docker, installazioni vecchie): `.next`.
 */
function cartellaBuild(): string {
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

const nextConfig: NextConfig = {
  distDir: cartellaBuild(),
  serverExternalPackages: ["better-sqlite3", "ssh2", "net-snmp", "bcrypt", "oui", "oui-data", "ldapts"],
};

export default nextConfig;
