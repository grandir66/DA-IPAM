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
  // Niente «X-Powered-By: Next.js» nelle risposte (piano di sicurezza 14/11).
  poweredByHeader: false,
  // Due intestazioni che valgono anche senza nginx davanti e non toccano le integrazioni in riquadro:
  // il browser non indovina il tipo dei file, e fuori dal sito non parte l'indirizzo completo della pagina.
  // HSTS e X-Frame-Options restano a nginx (`deploy/nginx-ssl.conf`); una Content-Security-Policy va provata
  // pagina per pagina e non c'è ancora.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
