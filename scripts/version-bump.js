#!/usr/bin/env node
/**
 * Incrementa la patch version in package.json e package-lock.json (es. 0.2.1 → 0.2.2).
 * Uso: npm run version:bump
 */

const fs = require("fs");
const path = require("path");

const pkgPath = path.join(process.cwd(), "package.json");
const lockPath = path.join(process.cwd(), "package-lock.json");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const parts = pkg.version.split(".").map(Number);
if (parts.length < 3) {
  parts.push(0);
}
parts[2] = (parts[2] || 0) + 1;
const newVersion = parts.join(".");
pkg.version = newVersion;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
  lock.version = newVersion;
  if (lock.packages?.[""]) lock.packages[""].version = newVersion;
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
}

const versionFilePath = path.join(process.cwd(), "VERSION");
fs.writeFileSync(versionFilePath, `${newVersion}\n`);

console.log(`Version bumped: ${newVersion}`);
