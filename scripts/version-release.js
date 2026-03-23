#!/usr/bin/env node
/**
 * Release: incrementa la patch (come version-bump) e crea un commit Git con messaggio `release: vX.Y.Z`.
 * Uso:
 *   node scripts/version-release.js           → bump + git add -A + commit
 *   node scripts/version-release.js --no-bump → solo commit con la versione già in package.json
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const noBump = process.argv.includes("--no-bump");

if (!noBump) {
  execSync("node " + path.join(__dirname, "version-bump.js"), { stdio: "inherit", cwd: root });
}

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const v = pkg.version;

try {
  execSync("git add -A", { stdio: "inherit", cwd: root });
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
