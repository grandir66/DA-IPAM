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
  {
    // Turbopack 16.4 fa di ogni path.join/path.resolve scritto nel modulo un glob da
    // tracciare e leggere in build: con un pezzo variabile prende tutta data/ (sull'hub
    // 54 GB, build fuori memoria il 27/10/2026). Nel codice dell'app si passa da
    // unisci/risolvi di src/lib/percorsi.ts; il controllo dopo la build
    // (scripts/controlla-tracciamento.mjs) ferma le altre forme.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/lib/percorsi.ts", "src/**/__tests__/**", "src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='path'][callee.property.name=/^(join|resolve)$/]",
          message: "Usa unisci/risolvi di @/lib/percorsi: path.join e path.resolve fanno tracciare data/ a Turbopack.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: ["path", "node:path"].map((name) => ({
            name,
            importNames: ["join", "resolve"],
            message: "Usa unisci/risolvi di @/lib/percorsi: path.join e path.resolve fanno tracciare data/ a Turbopack.",
          })),
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Le due cartelle di build di scripts/update.sh (next.config.ts).
    ".next-a/**",
    ".next-b/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worktree usati dagli agent: copie del repo, non sorgente da lintare.
    ".claude/**",
  ]),
]);

export default eslintConfig;
