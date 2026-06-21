import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import { join, resolve } from "path";

const SECRET_NAMES = ["ENCRYPTION_KEY", "AUTH_SECRET"] as const;
export type EnvSecretName = (typeof SECRET_NAMES)[number];

/** Modalità container appliance (compose). Equivalente systemd: solo `.env.local` unico. */
export function isContainerDeploy(): boolean {
  return process.env.DA_INVENT_CONTAINER === "1";
}

/**
 * Percorso file segreti — parità con hub systemd:
 * - VM/LXC: `/opt/da-invent/.env.local` (cwd)
 * - Docker: `/data/.env.local` sul volume persistente (sopravvive al rebuild immagine)
 */
export function resolveEnvSecretsPath(): string {
  const explicit = process.env.DA_INVENT_SECRETS_FILE?.trim();
  if (explicit) return resolve(explicit);

  if (isContainerDeploy()) {
    const dataDir = process.env.DA_INVENT_DATA_DIR?.trim() || "/data";
    return join(dataDir, ".env.local");
  }

  return join(process.cwd(), ".env.local");
}

/** Compose usa spesso NEXTAUTH_SECRET; Auth.js legge AUTH_SECRET. */
export function normalizeAuthEnvAliases(): void {
  if (!process.env.AUTH_SECRET?.trim()) {
    const next = process.env.NEXTAUTH_SECRET?.trim();
    if (next) process.env.AUTH_SECRET = next;
  }
  if (!process.env.NEXTAUTH_SECRET?.trim() && process.env.AUTH_SECRET?.trim()) {
    process.env.NEXTAUTH_SECRET = process.env.AUTH_SECRET;
  }
}

/** In container la chiave DEVE arrivare dal compose — mai generazione random silenziosa. */
export function assertContainerSecretsConfigured(): void {
  if (!isContainerDeploy()) return;

  if (!process.env.ENCRYPTION_KEY?.trim()) {
    console.error(
      "FATAL [env-secrets] DA-IPAM container: ENCRYPTION_KEY mancante.\n" +
        "  Impostala in /opt/appliance-stack/.env e passala nel compose.\n" +
        "  Vedi deploy/docker/compose.da-ipam.example.yml e docs/playbooks/APPLIANCE-DEPLOY.md"
    );
    process.exit(1);
  }

  if (!process.env.AUTH_SECRET?.trim()) {
    console.error(
      "FATAL [env-secrets] DA-IPAM container: AUTH_SECRET (o NEXTAUTH_SECRET) mancante nel compose."
    );
    process.exit(1);
  }
}

function upsertEnvLine(content: string, key: EnvSecretName, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) return content.replace(re, line);
  const trimmed = content.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n${line}\n` : `${line}\n`;
}

function readEnvLine(content: string, key: EnvSecretName): string | null {
  const m = content.match(new RegExp(`^${key}=(.+)$`, "m"));
  return m?.[1]?.trim() ?? null;
}

function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Garantisce ENCRYPTION_KEY e AUTH_SECRET coerenti tra runtime (Docker/systemd) e file segreti.
 *
 * Regola (identica hub e appliance):
 * - runtime `process.env` vince sempre se valorizzato;
 * - il file segreti viene allineato alla runtime, mai il contrario;
 * - in container non si generano chiavi random (fail-fast prima di ensureEnvSecrets).
 */
export function ensureEnvSecrets(options?: { envPath?: string; log?: (msg: string) => void }): void {
  normalizeAuthEnvAliases();

  const envPath = options?.envPath ?? resolveEnvSecretsPath();
  const log = options?.log ?? console.log;
  const warn = console.warn.bind(console);

  mkdirSync(resolve(envPath, ".."), { recursive: true });

  let content = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  let dirty = false;

  for (const name of SECRET_NAMES) {
    const runtime = process.env[name]?.trim();
    const fileValue = readEnvLine(content, name);

    if (runtime) {
      if (fileValue && fileValue !== runtime) {
        warn(
          `[env-secrets] ${name} nel file segreti diversa da runtime (Docker/systemd). ` +
            `Allineamento ${envPath} → chiave runtime.`
        );
        content = upsertEnvLine(content, name, runtime);
        dirty = true;
      } else if (!fileValue) {
        content = upsertEnvLine(content, name, runtime);
        dirty = true;
      }
      continue;
    }

    if (fileValue) {
      process.env[name] = fileValue;
      continue;
    }

    // Solo dev/LXC first-boot (non container — container esce prima con assertContainerSecretsConfigured)
    const generated = generateSecret();
    process.env[name] = generated;
    content = upsertEnvLine(content, name, generated);
    dirty = true;
    log(`[env-secrets] Generata ${name} in ${envPath} (primo avvio)`);
  }

  if (dirty) {
    writeFileSync(envPath, content.replace(/^\n+/, ""), { mode: 0o600 });
    log(`[env-secrets] File segreti aggiornato: ${envPath}`);
  }
}

export function getDeployModeLabel(): "container" | "systemd" {
  return isContainerDeploy() ? "container" : "systemd";
}
