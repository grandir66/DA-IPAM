/**
 * Risolve l'interprete Python per i bridge sidecar (WinRM, WMI, SSH).
 * Ordine: env esplicita → venv appliance → venv home → system python3.
 */
import { existsSync } from "fs";
import path from "path";

export function findBridgePython(): string {
  if (process.env.WINRM_PYTHON?.trim()) return process.env.WINRM_PYTHON.trim();
  if (process.env.SSH_PYTHON?.trim()) return process.env.SSH_PYTHON.trim();

  const appDir = process.env.DA_INVENT_APP_DIR || process.cwd();
  const home = process.env.HOME || "/root";
  const cwd = process.cwd();

  const candidates = [
    path.join(home, ".da-invent-venv", "bin", "python3"),
    path.join(appDir, ".venv-winrm", "bin", "python3"),
    path.join(home, ".da-inventory-venv", "bin", "python3"),
    path.join(home, ".da-ipam-venv", "bin", "python3"),
    path.join(cwd, ".venv-winrm", "bin", "python3"),
    path.join(cwd, ".venv", "bin", "python3"),
    "/opt/da-ipam/.venv-winrm/bin/python3",
    "/opt/dadude-agent/venv/bin/python3",
    "/usr/bin/python3",
  ];

  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* skip */
    }
  }

  return "python3";
}
