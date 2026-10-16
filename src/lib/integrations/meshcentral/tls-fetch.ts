/**
 * Probe HTTP verso MeshCentral che tollera il cert SELF-SIGNED del server
 * co-locato, senza disattivare il TLS globale.
 *
 * `fetch` (undici) IGNORA l'opzione `agent`, quindi contro un cert self-signed
 * fallisce sempre con DEPTH_ZERO_SELF_SIGNED_CERT / "unable to verify the first
 * certificate". È lo stesso motivo per cui network-services/client.ts usa
 * node:https con un insecureAgent. Qui applichiamo lo stesso rimedio, ma SOLO
 * quando il server risolve a questa macchina (o con l'override esplicito): verso
 * un MeshCentral che non è locale la verifica TLS resta attiva, come deve.
 *
 * Nasce da un warning falso durante l'install su 4.8 (2026-07-20): il self-check
 * del login-token usava `fetch()` sul server self-signed, falliva al TLS e
 * segnalava "il controllo remoto potrebbe non funzionare" pur essendo il token
 * perfettamente valido.
 */
import https from "node:https";
import { isSelfHostResolved } from "./control-client";

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * GET verso `url`, ritorna il solo status HTTP (basta al self-check e ai probe
 * di liveness). Accetta il cert self-signed se il server è locale.
 */
export async function meshProbeStatus(url: string, timeoutMs = 8000): Promise<number> {
  const insecure =
    process.env.MESHCENTRAL_TLS_INSECURE === "1" || (await isSelfHostResolved(url));

  if (!insecure) {
    // Server non locale: verifica TLS normale.
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status;
  }

  return new Promise<number>((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch (e) {
      reject(e as Error);
      return;
    }
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        agent: insecureAgent,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume(); // scarta il body: ci serve solo lo status
        resolve(res.statusCode || 0);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}
