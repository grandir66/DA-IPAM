#!/usr/bin/env node
/**
 * Release: incrementa la patch (come version-bump) e crea un commit Git con messaggio `release: vX.Y.Z`.
 * Uso:
 *   node scripts/version-release.js                → bump + git add -A + commit (legacy, include tutto il working tree)
 *   node scripts/version-release.js --no-bump      → solo commit con la versione già in package.json
 *   node scripts/version-release.js --staged-only  → bump + stage SOLO VERSION/package.json/lock + commit (preserva staging esistente)
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const noBump = process.argv.includes("--no-bump");
const stagedOnly = process.argv.includes("--staged-only");

if (!noBump) {
  execSync("node " + path.join(__dirname, "version-bump.js"), { stdio: "inherit", cwd: root });
}

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const v = pkg.version;

try {
  if (stagedOnly) {
    // Aggiunge SOLO i file di versioning, rispettando lo staging già preparato dal chiamante.
    // Evita di catturare modifiche estranee nel commit di release.
    const versionFiles = ["VERSION", "package.json", "package-lock.json", "yarn.lock"];
    for (const file of versionFiles) {
      const fp = path.join(root, file);
      if (fs.existsSync(fp)) {
        try {
          execSync(`git add ${file}`, { stdio: "ignore", cwd: root });
        } catch (err) {
          // Ignora file non in git (es. yarn.lock se progetto è npm-only)
        }
      }
    }
    const staged = execSync("git diff --cached --name-only", { encoding: "utf-8", cwd: root }).trim();
    console.log("File staged per il commit di release:\n" + staged);
  } else {
    execSync("git add -A", { stdio: "inherit", cwd: root });
  }
  execSync(`git commit -m "release: v${v}"`, { stdio: "inherit", cwd: root });
  console.log(`Commit creato: release: v${v}`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("nothing to commit") || msg.includes("no changes added")) {
    console.error("Nessuna modifica da committare (working tree pulito dopo bump?).");
  } else {
    console.error(msg);
  }
  process.exit(1);
}
