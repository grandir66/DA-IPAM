import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Allow setState in effects for data-fetching patterns
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Script Node standalone: CommonJS per natura, non moduli ESM del bundle.
    files: ["scripts/**/*.js", "scripts/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Il layer DB usa require() lazy DENTRO i corpi funzione per rompere il ciclo
    // db.ts <-> db-tenant.ts <-> db-hub.ts e per non inizializzare better-sqlite3
    // a build-time (vedi getDb() in db.ts). Convertirli a import ESM reintroduce
    // le circolari: e' una scelta architetturale, non debito.
    // Un require() in un file NON elencato qui resta un errore: va aggiunto qui
    // solo con la stessa giustificazione.
    files: [
      "src/lib/db.ts",
      "src/lib/db-tenant.ts",
      "src/lib/db-legacy.ts",
      "src/lib/scanner/device-fingerprint.ts",
      "src/lib/scanner/snmp-vendor-profiles.ts",
      "src/app/onboarding/page.tsx",
      "src/app/api/onboarding/status/route.ts",
    ],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worktree usati dagli agent: copie del repo, non sorgente da lintare.
    ".claude/**",
  ]),
]);

export default eslintConfig;
