import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

/** Sanitizza il dominio per prevenire command injection: solo alfanumerici, punti, trattini */
function sanitizeDomain(domain: string): string | null {
  const sanitized = domain.trim();
  if (!/^[a-zA-Z0-9.-]+$/.test(sanitized)) {
    return null;
  }
  if (sanitized.length > 253) {
    return null;
  }
  return sanitized;
}

export async function GET() {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const certPath = process.env.TLS_CERT;
    const keyPath = process.env.TLS_KEY;

    const result: {
      enabled: boolean;
      cert_path: string | null;
      key_path: string | null;
      cert_exists: boolean;
      key_exists: boolean;
      cert_info: Record<string, string> | null;
    } = {
      enabled: !!(certPath && keyPath),
      cert_path: certPath || null,
      key_path: keyPath || null,
      cert_exists: certPath ? existsSync(certPath) : false,
      key_exists: keyPath ? existsSync(keyPath) : false,
      cert_info: null,
    };

    // Leggi info certificato se esiste
    if (result.cert_exists && certPath) {
      try {
        const output = execSync(
          `openssl x509 -in "${certPath}" -noout -subject -issuer -dates -fingerprint 2>/dev/null`,
          { encoding: "utf-8" }
        );
        const info: Record<string, string> = {};
        for (const line of output.trim().split("\n")) {
          const [key, ...rest] = line.split("=");
          if (key && rest.length) {
            info[key.trim().toLowerCase()] = rest.join("=").trim();
          }
        }
        result.cert_info = info;
      } catch {
        /* openssl non disponibile */
      }
    }

    return NextResponse.json(result, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    console.error("Errore lettura stato TLS:", error);
    return NextResponse.json(
      { error: "Errore nel recupero dello stato TLS" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const body = await request.json() as {
      action?: string;
      domain?: string;
      days?: number;
      cert?: string;
      key?: string;
    };

    if (body.action === "generate") {
      const rawDomain = body.domain || "localhost";
      const domain = sanitizeDomain(rawDomain);
      if (!domain) {
        return NextResponse.json(
          { error: "Dominio non valido: sono ammessi solo caratteri alfanumerici, punti e trattini" },
          { status: 400 }
        );
      }

      const days = Math.max(1, Math.min(body.days || 365, 3650));
      const certDir = path.join(process.cwd(), "data", "certs");
      mkdirSync(certDir, { recursive: true });

      const certPath = path.join(certDir, "cert.pem");
      const keyPath = path.join(certDir, "key.pem");

      try {
        execSync(
          `openssl req -x509 -newkey rsa:4096 -keyout "${keyPath}" -out "${certPath}" -days ${days} -nodes -subj "/CN=${domain}" -addext "subjectAltName=DNS:${domain},IP:127.0.0.1"`,
          { stdio: "pipe" }
        );
        chmodSync(keyPath, 0o600);
        chmodSync(certPath, 0o644);

        // Aggiorna .env.local con i percorsi TLS
        updateEnvTls(certPath, keyPath);

        return NextResponse.json({
          success: true,
          message: `Certificato generato per ${domain} (valido ${days} giorni). Riavvia il server per attivare HTTPS.`,
          cert_path: certPath,
          key_path: keyPath,
        });
      } catch (err) {
        return NextResponse.json(
          { error: `Errore generazione certificato: ${(err as Error).message}` },
          { status: 500 }
        );
      }
    }

    if (body.action === "import") {
      if (!body.cert || !body.key) {
        return NextResponse.json(
          { error: "Certificato e chiave privata sono obbligatori" },
          { status: 400 }
        );
      }

      const certDir = path.join(process.cwd(), "data", "certs");
      mkdirSync(certDir, { recursive: true });

      const certPath = path.join(certDir, "cert.pem");
      const keyPath = path.join(certDir, "key.pem");

      try {
        // Decodifica base64 se necessario
        const certContent = isBase64(body.cert)
          ? Buffer.from(body.cert, "base64").toString("utf-8")
          : body.cert;
        const keyContent = isBase64(body.key)
          ? Buffer.from(body.key, "base64").toString("utf-8")
          : body.key;

        writeFileSync(certPath, certContent);
        writeFileSync(keyPath, keyContent);
        chmodSync(keyPath, 0o600);
        chmodSync(certPath, 0o644);

        // Verifica che il certificato sia valido
        execSync(`openssl x509 -in "${certPath}" -noout 2>&1`);

        // Aggiorna .env.local
        updateEnvTls(certPath, keyPath);

        return NextResponse.json({
          success: true,
          message: "Certificato importato. Riavvia il server per attivare HTTPS.",
          cert_path: certPath,
          key_path: keyPath,
        });
      } catch (err) {
        return NextResponse.json(
          { error: `Certificato non valido: ${(err as Error).message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { error: "Azione non riconosciuta. Usa 'generate' o 'import'." },
      { status: 400 }
    );
  } catch (error) {
    console.error("Errore gestione TLS:", error);
    return NextResponse.json(
      { error: "Errore nella gestione del certificato TLS" },
      { status: 500 }
    );
  }
}

/** Aggiorna le variabili TLS_CERT e TLS_KEY nel file .env.local */
function updateEnvTls(certPath: string, keyPath: string): void {
  const envPath = path.join(process.cwd(), ".env.local");
  let envContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
  envContent = envContent
    .replace(/^TLS_CERT=.*$/m, "")
    .replace(/^TLS_KEY=.*$/m, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  envContent += `\nTLS_CERT=${certPath}\nTLS_KEY=${keyPath}\n`;
  writeFileSync(envPath, envContent);
}

/** Verifica se una stringa è codificata in base64 */
function isBase64(str: string): boolean {
  if (str.startsWith("-----BEGIN")) return false;
  try {
    const decoded = Buffer.from(str, "base64").toString("utf-8");
    return decoded.startsWith("-----BEGIN") || Buffer.from(decoded).toString("base64") === str;
  } catch {
    return false;
  }
}
