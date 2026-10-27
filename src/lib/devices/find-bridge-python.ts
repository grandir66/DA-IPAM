/**
 * Risolve l'interprete Python per i bridge sidecar (WinRM, WMI, SSH).
 * Ordine: env esplicita → venv appliance → venv home → system python3.
 */
import { existsSync } from "fs";
import { unisci } from "../percorsi";

export function findBridgePython(): string {
  if (process.env.WINRM_PYTHON?.trim()) return process.env.WINRM_PYTHON.trim();
  if (process.env.SSH_PYTHON?.trim()) return process.env.SSH_PYTHON.trim();

  const appDir = process.env.DA_INVENT_APP_DIR || process.cwd();
  const home = process.env.HOME || "/root";
  const cwd = process.cwd();

  const candidates = [
    unisci(home, ".da-invent-venv", "bin", "python3"),
    unisci(appDir, ".venv-winrm", "bin", "python3"),
    unisci(home, ".da-inventory-venv", "bin", "python3"),
    unisci(home, ".da-ipam-venv", "bin", "python3"),
    unisci(cwd, ".venv-winrm", "bin", "python3"),
    unisci(cwd, ".venv", "bin", "python3"),
    unisci("/opt/da-ipam", ".venv-winrm", "bin", "python3"),
    unisci("/opt/dadude-agent", "venv", "bin", "python3"),
    unisci("/usr/bin", "python3"),
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
