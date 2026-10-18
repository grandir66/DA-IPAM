/**
 * Desktop remoto SENZA agente: RDP e VNC verso un host scoperto da DA-IPAM,
 * passando da MeshCentral, senza installare niente sulla postazione.
 *
 * Come funziona (verificato sul sorgente di MeshCentral 1.2.x, 2026-10-18):
 *   - MeshCentral ha i gruppi «Local devices» (meshtype 3): device senza agente,
 *     a cui si collega IL SERVER STESSO (meshrelay.js CreateLocalRelay). Il nostro
 *     server sta sull'appliance, nella LAN del cliente: niente agente ponte.
 *   - DA-IPAM crea alla bisogna il gruppo «Domarc Senza Agente» e, al primo clic,
 *     il device con l'IP dell'host ('addlocaldevice'). Nessuna sincronizzazione di
 *     massa: in MeshCentral finiscono solo gli host su cui qualcuno ha aperto una
 *     sessione.
 *   - RDP: pagina `mstsc.html?login=<token>&node=<id>&port=<p>` (webserver.js
 *     handleMSTSCRequest), che accetta il nostro login-token monouso.
 *   - VNC: cookie di relay da 'getcookie' e pagina noVNC su `localrelay.ashx`,
 *     esattamente come fa la console di MeshCentral (default.handlebars, tag novnc).
 *
 * Credenziali: restano in DA-IPAM. La pagina RDP di MeshCentral le chiede al
 * momento (non esiste un'API per passargliele); VNC chiede la sua password.
 *
 * Spento di default: serve MESHCENTRAL_SENZA_AGENTE=1, finché non è provato sul
 * pilota. Con il flag spento i pulsanti non compaiono e la rotta risponde 409.
 */
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { getMeshCreds as realGetMeshCreds, type MeshCreds } from "./config";
import { mintLoginToken as realMintLoginToken } from "./login-token";
import { recordRemoteSession as realRecordRemoteSession } from "./remote-session-audit";
import { meshAttivo as realMeshAttivo, MESH_DISATTIVATO } from "./feature";
import { MeshControlClient, type MeshNode } from "./control-client";
import { porteAperte, portaSessione, type ProtocolloRemoto } from "./senza-agente-porte";

export { porteAperte, portaPer, portaSessione, protocolliDisponibili, type ProtocolloRemoto } from "./senza-agente-porte";

export const GRUPPO_SENZA_AGENTE = "Domarc Senza Agente";

export const SENZA_AGENTE_SPENTO =
  "Desktop remoto senza agente non attivo su questa appliance (MESHCENTRAL_SENZA_AGENTE)";

/**
 * Viewmode scritti nell'audit mc_remote_session. 11/12/13 sono di MeshCentral
 * (sessioni con agente); 21/22 sono nostri, per distinguere le sessioni senza agente.
 */
export const VIEWMODE_AUDIT: Record<ProtocolloRemoto, number> = { rdp: 21, vnc: 22 };

export function senzaAgenteAttivo(): boolean {
  return process.env.MESHCENTRAL_SENZA_AGENTE === "1";
}

/** Tipo device di 'addlocaldevice': 4 Windows · 6 Linux · 29 macOS (solo icona). */
function tipoDevice(osFamily: string | null): 4 | 6 | 29 {
  if (osFamily === "Windows") return 4;
  if (osFamily === "Apple") return 29;
  return 6;
}

/** id nudo per i parametri URL di MeshCentral (stessa trappola di deep-link.ts). */
function idNudo(nodeId: string): string {
  return nodeId.replace(/^node\/[^/]*\//, "");
}

/** https://host[:porta] del server MeshCentral, senza slash finali. */
function origine(serverUrl: string): string {
  return "https://" + serverUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function buildRdpUrl(opts: { serverUrl: string; token: string; nodeId: string; port: number }): string {
  return (
    `${origine(opts.serverUrl)}/mstsc.html?login=${encodeURIComponent(opts.token)}` +
    `&node=${encodeURIComponent(idNudo(opts.nodeId))}&port=${opts.port}`
  );
}

export function buildVncUrl(opts: { serverUrl: string; cookie: string; name: string }): string {
  const o = origine(opts.serverUrl);
  const ws = `${o.replace(/^https/, "wss")}/localrelay.ashx?auth=${opts.cookie}`;
  return (
    `${o}/novnc/vnc.html?ws=${encodeURIComponent(ws)}&show_dot=1` +
    `&name=${encodeURIComponent(opts.name)}`
  );
}

/** Superficie del client usata qui: i test la sostituiscono con un finto. */
export interface ClientSenzaAgente {
  listMeshes(): Promise<Array<{ meshId: string; name: string; mtype: number }>>;
  addLocalMesh(name: string): Promise<string>;
  listNodes(): Promise<MeshNode[]>;
  addLocalDevice(meshId: string, deviceName: string, hostname: string, type: 4 | 6 | 29): Promise<void>;
  getRelayCookie(nodeId: string, tcpport: number): Promise<string>;
  close(): void;
}

export interface SenzaAgenteDeps {
  attivo: () => boolean;
  meshAttivo: () => boolean;
  getMeshCreds: () => MeshCreds | null;
  mintLoginToken: (opts: { meshUser: string; expireMinutes: number; once?: boolean }) => string;
  recordRemoteSession: typeof realRecordRemoteSession;
  client: (creds: MeshCreds) => ClientSenzaAgente;
}

const defaultDeps: SenzaAgenteDeps = {
  attivo: senzaAgenteAttivo,
  meshAttivo: () => realMeshAttivo(),
  getMeshCreds: realGetMeshCreds,
  mintLoginToken: realMintLoginToken,
  recordRemoteSession: realRecordRemoteSession,
  client: (creds) => new MeshControlClient(creds),
};

interface HostRow {
  ip: string;
  hostname: string | null;
  custom_name: string | null;
  open_ports: string | null;
  os_family: string | null;
}

/** Gruppo senza agente: lo cerca per nome e tipo, se manca lo crea. */
async function gruppo(client: ClientSenzaAgente): Promise<string> {
  const esistente = (await client.listMeshes()).find(
    (m) => m.name === GRUPPO_SENZA_AGENTE && m.mtype === 3,
  );
  if (esistente) return esistente.meshId;
  return client.addLocalMesh(GRUPPO_SENZA_AGENTE);
}

/** Pausa fra i tentativi di ritrovare un device appena creato. */
export const ATTESA_DEVICE_MS = 400;

/** Device con questo IP nel gruppo; al primo uso lo crea. */
async function device(
  client: ClientSenzaAgente,
  meshId: string,
  host: HostRow,
): Promise<MeshNode> {
  const cerca = async () =>
    (await client.listNodes()).find((n) => n.agentless && n.meshId === meshId && n.host === host.ip);
  const trovato = await cerca();
  if (trovato) return trovato;
  const nome = host.custom_name || host.hostname || host.ip;
  await client.addLocalDevice(meshId, nome, host.ip, tipoDevice(host.os_family));
  // Il server risponde 'ok' prima che la scrittura nel suo DB sia finita
  // (db.Set non atteso in 'addlocaldevice'): qualche tentativo ravvicinato.
  for (let tentativo = 0; tentativo < 5; tentativo++) {
    const creato = await cerca();
    if (creato) return creato;
    await new Promise((r) => setTimeout(r, ATTESA_DEVICE_MS));
  }
  throw new Error("device creato ma non ritrovato in MeshCentral");
}

/**
 * Prepara una sessione RDP o VNC senza agente verso l'host e ne restituisce
 * l'URL da mettere nell'iframe. Token e cookie non vengono mai salvati né loggati.
 */
export async function prepareSessioneSenzaAgente(
  input: { hostId: number; protocollo: ProtocolloRemoto; operator: string },
  deps: SenzaAgenteDeps = defaultDeps,
): Promise<{ ok: true; url: string } | { ok: false; status: number; error: string }> {
  const code = getCurrentTenantCode();
  if (!code) return { ok: false, status: 401, error: "Nessun contesto tenant" };
  if (!deps.meshAttivo()) return { ok: false, status: 409, error: MESH_DISATTIVATO };
  if (!deps.attivo()) return { ok: false, status: 409, error: SENZA_AGENTE_SPENTO };

  const host = getTenantDb(code)
    .prepare("SELECT ip, hostname, custom_name, open_ports, os_family FROM hosts WHERE id = ?")
    .get(input.hostId) as HostRow | undefined;
  if (!host) return { ok: false, status: 404, error: "Host non trovato" };

  // Porta trovata dalla scansione, altrimenti quella standard: la scansione può
  // non averla vista (veloce, vecchia), e se è chiusa lo dice MeshCentral.
  const porta = portaSessione(input.protocollo, porteAperte(host.open_ports));

  const creds = deps.getMeshCreds();
  if (!creds) return { ok: false, status: 409, error: "MeshCentral non configurato per questo tenant" };
  const meshUser = `user/${creds.domain}/${creds.serviceUser}`;

  const audit = (status: "minted" | "failed") =>
    deps.recordRemoteSession({
      hostId: input.hostId,
      // node_id ha la FK verso mc_node, dove i device senza agente non stanno.
      nodeId: null,
      operator: input.operator,
      meshUser,
      viewmode: VIEWMODE_AUDIT[input.protocollo],
      expireMinutes: 3,
      once: input.protocollo === "rdp",
      status,
    });

  const client = deps.client(creds);
  let url: string;
  try {
    const meshId = await gruppo(client);
    const nodo = await device(client, meshId, host);
    if (input.protocollo === "rdp") {
      const token = deps.mintLoginToken({ meshUser, expireMinutes: 3, once: true });
      url = buildRdpUrl({ serverUrl: creds.serverUrl, token, nodeId: nodo.nodeId, port: porta });
    } else {
      const cookie = await client.getRelayCookie(nodo.nodeId, porta);
      url = buildVncUrl({ serverUrl: creds.serverUrl, cookie, name: nodo.name || host.ip });
    }
  } catch (err) {
    audit("failed");
    const motivo = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 502, error: `MeshCentral non ha aperto la sessione: ${motivo}` };
  } finally {
    client.close();
  }

  audit("minted");
  return { ok: true, url };
}
