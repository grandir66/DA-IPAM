/**
 * Legge dalla macchina i fatti delle schede di «Protezione» (tappa 1: SOLA LETTURA, nessun comando che scrive).
 * Ogni fonte che manca dà `null` e la pagina dice «non letto»: su un Mac di sviluppo `ss`, `docker` e `nft` non
 * ci sono. Mai una shell: `execFile` con argomenti fissi.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { getUsers } from "@/lib/db-hub";
import { withTenant, getConteggioCredenzialiPerTipo, getNomiHostPerIp } from "@/lib/db-tenant";
import { leggiRighe } from "@/lib/dalink/config";
import { unisci } from "@/lib/percorsi";
import { vaultLocaleAcceso } from "@/lib/vault/stato";
import { eAdmin } from "@/lib/permessi/ruolo";
import { leggiAscolto, type Ascolto } from "./ascolto";
import { leggiContainer, type Container } from "./container";
import { interneEsposte, portePresentate, type PortaPresentata } from "./porte";
import { inRete, leggiConnessioni, type SistemaRemoto } from "./sistemi";
import { righeStato, type RigaStato } from "./stato";

const SCHEDA_NETBIRD = "wt0";
const RETE_NETBIRD = "100.64.0.0/10";
const FILE_FIREWALL_DALINK = "/etc/dalink/firewall.env";

function esegui(comando: string, argomenti: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(comando, argomenti, { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

export interface SchedaRete {
  nome: string;
  indirizzi: string[];
  netbird: boolean;
}

/** Le schede di rete vere: niente loopback, bridge di Docker e `veth`. */
export function schedeDiRete(): SchedaRete[] {
  return Object.entries(os.networkInterfaces())
    .filter(([nome]) => !/^(lo|docker|br-|veth)/.test(nome))
    .map(([nome, ind]) => ({
      nome,
      indirizzi: (ind ?? []).filter((a) => !a.address.startsWith("fe80")).map((a) => a.cidr ?? a.address),
      netbird: nome === SCHEDA_NETBIRD,
    }))
    .filter((s) => s.indirizzi.length > 0);
}

/** Le reti dei bridge di Docker: il traffico fra container non è un «sistema remoto». */
function retiDocker(): string[] {
  return Object.entries(os.networkInterfaces())
    .filter(([nome]) => /^(docker|br-)/.test(nome))
    .flatMap(([, ind]) => (ind ?? []).filter((a) => a.family === "IPv4" && a.cidr).map((a) => a.cidr as string));
}

async function leggiDocker(): Promise<Container[] | null> {
  const ids = await esegui("docker", ["ps", "-q"]);
  if (ids === null) return null;
  const elenco = ids.split("\n").map((x) => x.trim()).filter((x) => /^[0-9a-f]{6,64}$/.test(x));
  if (elenco.length === 0) return [];
  const json = await esegui("docker", ["inspect", ...elenco]);
  return json === null ? null : leggiContainer(json);
}

/** Le tabelle nftables caricate, per nome; `null` = `nft` non c'è o non si può leggere. */
async function tabelleNft(): Promise<string[] | null> {
  const testo = await esegui("nft", ["list", "tables"]);
  if (testo === null) return null;
  return testo.split("\n").map((r) => r.trim().split(/\s+/)).filter((c) => c[0] === "table" && c.length >= 3).map((c) => `${c[1]} ${c[2]}`);
}

function porteInterneChiuse(tabelle: string[] | null): boolean {
  if (!tabelle?.includes("inet dalink")) return false;
  try {
    return leggiRighe(fs.readFileSync(FILE_FIREWALL_DALINK, "utf8")).get("DALINK_FW_PORTE_INTERNE") === "chiuse";
  } catch {
    return false;
  }
}

async function sshConPassword(): Promise<boolean | null> {
  const testo = await esegui("sshd", ["-T"]);
  const riga = testo?.split("\n").find((r) => r.startsWith("passwordauthentication "));
  return riga ? riga.trim().endsWith(" yes") : null;
}

function permessiChiave(): number | null {
  try {
    return fs.statSync(unisci(process.cwd(), ".env.local")).mode & 0o777;
  } catch {
    return null;
  }
}

function firma(): "blocca" | "avvisa" | "spenta" {
  const v = (process.env.DA_INVENT_FIRMA_RILASCI ?? "").trim();
  return v === "avvisa" || v === "spenta" ? v : "blocca"; // ADR 0040: senza la chiave nel file è «blocca»
}

export interface UtenteProtezione {
  id: number;
  nome: string;
  ruolo: string;
  secondaVerifica: boolean;
  ultimoAccesso: string | null;
}

export interface SistemaConNome extends SistemaRemoto {
  /** Nome in inventario, «NetBird», oppure `null` = non riconosciuto. */
  nome: string | null;
}

export interface QuadroProtezione {
  schede: SchedaRete[];
  /** `null` = `ss` non c'è: le porte non si sanno. */
  porte: PortaPresentata[] | null;
  container: Container[] | null;
  sistemi: SistemaConNome[] | null;
  utenti: UtenteProtezione[];
  stato: RigaStato[];
  filtro: "assente" | "osserva" | "acceso" | null;
  lettoAlle: string;
}

export async function quadroProtezione(tenantCode: string): Promise<QuadroProtezione> {
  const [ssAscolto, ssAperte, container, tabelle, sshPassword] = await Promise.all([
    esegui("ss", ["-H", "-tulnp"]),
    esegui("ss", ["-H", "-tn", "state", "established"]),
    leggiDocker(),
    tabelleNft(),
    sshConPassword(),
  ]);
  const schede = schedeDiRete();
  const ascolto: Ascolto[] | null = ssAscolto === null ? null : leggiAscolto(ssAscolto);
  const indirizziNetbird = (os.networkInterfaces()[SCHEDA_NETBIRD] ?? []).map((a) => a.address);
  const porte = ascolto === null ? null : portePresentate({ ascolto, container, indirizziNetbird, porteInterneChiuse: porteInterneChiuse(tabelle) });

  let sistemi: SistemaConNome[] | null = null;
  if (ssAperte !== null && ascolto !== null) {
    const docker = retiDocker();
    const grezzi = leggiConnessioni(ssAperte, new Set(ascolto.filter((a) => a.proto === "tcp").map((a) => a.porta)), (ip) => docker.some((r) => inRete(ip, r)));
    let nomi = new Map<string, string | null>();
    try {
      nomi = new Map(withTenant(tenantCode, () => getNomiHostPerIp([...new Set(grezzi.map((g) => g.indirizzo))])).map((h) => [h.ip, h.nome]));
    } catch (e) {
      console.error("[protezione] nomi degli host non letti:", e);
    }
    sistemi = grezzi.map((g) => ({ ...g, nome: inRete(g.indirizzo, RETE_NETBIRD) ? "NetBird" : nomi.has(g.indirizzo) ? nomi.get(g.indirizzo) ?? "in inventario, senza nome" : null }));
  }

  const utenti: UtenteProtezione[] = getUsers().map((u) => ({ id: u.id, nome: u.username, ruolo: u.role, secondaVerifica: u.totp_attiva === 1, ultimoAccesso: u.last_login ?? null }));
  const admin = utenti.filter((u) => eAdmin(u.ruolo));

  let snmpVecchio: number | null = null;
  try {
    snmpVecchio = withTenant(tenantCode, () => getConteggioCredenzialiPerTipo()).filter((c) => c.tipo === "snmp" || c.tipo === "snmp_v2").reduce((s, c) => s + c.n, 0);
  } catch (e) {
    console.error("[protezione] conteggio delle credenziali non letto:", e);
  }

  const filtro = tabelle === null ? null : tabelle.includes("inet daipam_accessi") ? ("osserva" as const) : ("assente" as const);
  const stato = righeStato({
    filtro,
    porteATutti: porte?.filter((p) => p.raggiunge === "tutti").length ?? null,
    interneEsposte: porte ? interneEsposte(porte).map((p) => p.porta) : null,
    nonAttribuite: porte?.filter((p) => p.gruppo === "Non attribuita" && p.raggiunge === "tutti").length ?? null,
    conIpv6: porte?.filter((p) => p.ipv6 && p.raggiunge === "tutti").length ?? null,
    adminTotali: admin.length,
    adminSenzaSeconda: admin.filter((u) => !u.secondaVerifica).length,
    sshConPassword: sshPassword,
    vaultLocale: vaultLocaleAcceso(),
    permessiChiave: permessiChiave(),
    credenzialiSnmpVecchio: snmpVecchio,
    firma: firma(),
    root: typeof process.getuid === "function" ? process.getuid() === 0 : null,
    containerPrivilegiati: container?.filter((c) => c.privilegiato).map((c) => c.nome) ?? null,
  });
  return { schede, porte, container, sistemi, utenti, stato, filtro, lettoAlle: new Date().toISOString() };
}
