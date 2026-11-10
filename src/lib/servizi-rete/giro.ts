/**
 * Giro delle sonde sui servizi di rete di un tenant: allinea le porte già note, poi
 * sonda in parallelo (tetto di connessioni) e salva dopo ogni porta, così la pagina
 * vede i risultati mentre il giro va avanti e un'interruzione non perde il lavoro fatto.
 *
 * Con `porteComuni` (rete appena confermata dal trunk, Riccardo 09/11: «Sì, alla conferma»)
 * prima prova le porte TCP più comuni sugli host della rete, che dal giro ARP arrivano
 * senza porte note: solo connessione e chiusura, niente nmap.
 *
 * Un giro per tenant alla volta. Gira dentro il contesto del tenant (`withTenant`):
 * AsyncLocalStorage lo porta attraverso gli `await`.
 */
import {
  withTenant,
  allineaServiziRete,
  getPorteServiziDaSondare,
  salvaEsitoSondaServizio,
  getHostServiziDellaRete,
  registraPorteAperteServizi,
  getHostSenzaPorteServizi,
  segnaHostProvatoServizi,
  raccogliIdentita,
  riempiOsVuotiServizi,
  getPorteServiziDaControllare,
  salvaControlloServizioRete,
  getCredenzialiValidateServizi,
  salvaSondaUdpServizio,
  accessoSshCredenziale,
  getTenantDb,
} from "@/lib/db-tenant";
import { sondeUdpHost, type EsitoUdp } from "./sonde-udp";
import { runSshCommand } from "@/lib/devices/ssh-run";
import { COMANDO_SSH, eRifiutoSsh, eShellPosix, leggiUscitaSsh } from "@/lib/rilievi/autenticati";
import { portaAperta, sondaPorta, type EsitoSonda } from "./sonde";
import { portePerGiro } from "./porte";
import { PORTE_DA_NON_TOCCARE, PRODUTTORE_DI_CAMPO } from "@/lib/scanner/profili/sconosciuti";
import { eImpianto as eImpiantoPuro } from "@/lib/vuln/impianti-in-rete";
import { leggiEsclusi } from "@/lib/vuln/proposta/store";
import { protocolloControllo, TETTO_FABBRICA_PER_HOST } from "@/lib/rilievi/controlli";
import { PORTE_CONTROLLO, sondaControllo, type EsitoSondaControllo } from "@/lib/rilievi/sonde-controlli";

/**
 * Freno: le porte di campo e di stampa non si sondano (sulla 9100 il nostro GET verrebbe
 * stampato), e nemmeno gli apparati di campo. Stesso elenco della ricognizione degli sconosciuti.
 */
export function daSaltare(porta: number, vendor: string | null): boolean {
  return PORTE_DA_NON_TOCCARE.has(porta) || (vendor !== null && PRODUTTORE_DI_CAMPO.test(vendor));
}

export interface StatoGiro {
  inCorso: boolean;
  networkId: number | null;
  /** «porte» mentre prova le porte comuni, «sonde» mentre legge le risposte. */
  fase: "porte" | "sonde" | "credenziali" | null;
  totale: number;
  fatte: number;
  iniziato: string | null;
  finito: string | null;
  errore: string | null;
}

/** Cosa ha fatto un giro, per la riga in cronologia: senza, «Solo controlli» restava «avviato» per sempre. */
export interface RiepilogoGiro {
  host: number;
  sondati: number;
  risposte: number;
  controlli: number;
  /** Host letti con la credenziale già validata, e credenziali validate che l'host ha rifiutato. */
  conCredenziali: number;
  credRifiutate: number;
  durataMs: number;
  errore: string | null;
}

const PARALLELE = 32;
const PARALLELE_PORTE = 256;
// Su globalThis: rotte, discovery e `server.ts` possono avere istanze diverse del modulo, e la
// pagina deve vedere anche un giro partito dal programmatore (come `trunk/job.ts`).
const g = globalThis as typeof globalThis & {
  __giriServiziRete?: Map<string, StatoGiro>;
  __codaSondeDiscovery?: Map<string, Map<string, () => void>>;
};
const giri = (g.__giriServiziRete ??= new Map<string, StatoGiro>());
const codeDiscovery = (g.__codaSondeDiscovery ??= new Map<string, Map<string, () => void>>());

export function statoGiro(tenant: string): StatoGiro {
  return giri.get(tenant) ?? { inCorso: false, networkId: null, fase: null, totale: 0, fatte: 0, iniziato: null, finito: null, errore: null };
}

export interface Strumenti {
  sonda: (ip: string, porta: number) => Promise<EsitoSonda | null>;
  aperta: (ip: string, porta: number) => Promise<boolean>;
  /** Le domande UDP di protocollo a un host. Assente nelle prove iniettate: non partono. */
  udp?: (ip: string) => Promise<EsitoUdp[]>;
  /** Esegue `COMANDO_SSH` e torna lo stdout. Sostituibile nelle prove. */
  ssh?: (o: { host: string; port: number; username: string; password: string }) => Promise<string>;
  /** Assente nelle prove iniettate: i controlli veri non partono. */
  controllo?: (ip: string, porta: number, opz: { proveFabbrica: boolean; consumaTentativo: () => boolean; tls?: boolean }) => Promise<EsitoSondaControllo>;
}

const STRUMENTI: Strumenti = {
  udp: (ip) => sondeUdpHost(ip),
  sonda: (ip, p) => sondaPorta(ip, p),
  aperta: (ip, p) => portaAperta(ip, p),
  controllo: (ip, p, opz) => sondaControllo(ip, p, opz),
};

/** Esegue `lavoro` su ogni voce con al massimo `n` in parallelo. */
async function inParallelo<T>(voci: T[], n: number, lavoro: (v: T) => Promise<void>): Promise<void> {
  let i = 0;
  const lavoratore = async () => {
    try {
      while (i < voci.length) await lavoro(voci[i++]);
    } catch (errore) {
      i = voci.length;
      throw errore;
    }
  };
  const esiti = await Promise.allSettled(Array.from({ length: Math.min(n, voci.length) }, lavoratore));
  const errore = esiti.find((e) => e.status === "rejected");
  if (errore) throw errore.reason;
}

/** Ogni quanti giorni si ripete, per host, la prova SMB anonima e «Guest». */
export const SMB_ANONIMO_OGNI_GIORNI = 7;

/** Vero se la prova SMB su quell'host e quella porta è stata fatta da meno di `SMB_ANONIMO_OGNI_GIORNI`. */
export function smbProvatoDiRecente(tenant: string, hostId: number, porta: number, adesso: number = Date.now()): boolean {
  try {
    const r = getTenantDb(tenant)
      .prepare("SELECT json_extract(NULLIF(controllo_json, ''), '$._smb_provato_il') AS quando FROM servizi_rete WHERE host_id = ? AND porta = ? AND protocollo = 'tcp'")
      .get(hostId, porta) as { quando: string | null } | undefined;
    const t = r?.quando ? Date.parse(r.quando) : NaN;
    return !Number.isNaN(t) && adesso - t < SMB_ANONIMO_OGNI_GIORNI * 86_400_000;
  } catch {
    return false; // riga o JSON illeggibili: si prova, come prima
  }
}

/** Segna la prova fatta, senza toccare `ultimo_visto` né il resto dell'esito. */
function segnaSmbProvato(tenant: string, hostId: number, porta: number): void {
  try {
    getTenantDb(tenant)
      .prepare(
        `UPDATE servizi_rete SET controllo_json = json_set(COALESCE(NULLIF(controllo_json, ''), '{}'), '$._smb_provato_il', ?)
          WHERE host_id = ? AND porta = ? AND protocollo = 'tcp'`,
      )
      .run(new Date().toISOString(), hostId, porta);
  } catch (e) {
    console.warn(`[servizi-rete] host #${hostId}: segno della prova SMB non scritto: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Una Discovery conclusa conserva il proprio perimetro anche se le sonde sono occupate. */
export function avviaSondeDopoDiscovery(
  tenant: string,
  networkId: number,
  opzioni: {
    proveFabbrica?: boolean;
    conCredenziali?: boolean;
    strumenti?: Strumenti;
    timeoutMs?: number;
    concorrenza?: number;
  } = {},
): void {
  if (avviaGiro(tenant, networkId, opzioni)) return;
  const coda = codeDiscovery.get(tenant) ?? new Map<string, () => void>();
  const chiave = `${networkId}:${opzioni.proveFabbrica === true}:${opzioni.conCredenziali === true}:${opzioni.timeoutMs ?? ""}:${opzioni.concorrenza ?? ""}`;
  coda.set(chiave, () => { avviaGiro(tenant, networkId, opzioni); });
  codeDiscovery.set(tenant, coda);
}

/**
 * Avvia il giro e ritorna subito. `false` se ce n'è già uno in corso per il tenant.
 * `strumenti` è sostituibile nelle prove.
 */
export function avviaGiro(
  tenant: string,
  ambito: number | readonly number[] | null,
  /** `porteComuni`: «rete» = gli host della rete (conferma dal trunk); «senza-porte» = gli host
   *  del tenant che non hanno porte note (giro automatico). */
  opzioni: {
    porteComuni?: "rete" | "senza-porte";
    strumenti?: Strumenti;
    porte?: number[];
    /** Login di fabbrica: solo da `/scans`, mai dai giri automatici. */
    proveFabbrica?: boolean;
    /** Timeout per bersaglio/sonda di questo giro (ms). Assente = default della sonda. */
    timeoutMs?: number;
    /** Worker in parallelo di questo giro. Assente = 32 sonde / 256 prove porte. */
    concorrenza?: number;
    /** Usa le credenziali SSH/SNMP già validate per l'host. Solo da `/scans`, mai dai giri automatici. */
    conCredenziali?: boolean;
    /** Chiamata a giro finito, dentro il contesto del tenant. */
    alTermine?: (riepilogo: RiepilogoGiro) => void;
  } = {},
): boolean {
  if (giri.get(tenant)?.inCorso) return false;
  const riepilogo: RiepilogoGiro = { host: 0, sondati: 0, risposte: 0, controlli: 0, conCredenziali: 0, credRifiutate: 0, durataMs: 0, errore: null };
  const partenza = Date.now();
  const reti = typeof ambito === "number" ? [ambito] : ambito ?? [undefined];
  const networkId = reti.length === 1 ? reti[0] ?? null : null;
  const timeoutMs = opzioni.timeoutMs;
  const parallele = opzioni.concorrenza ?? PARALLELE;
  const parallelePorte = opzioni.concorrenza ?? PARALLELE_PORTE;
  const { sonda, aperta, controllo } = opzioni.strumenti ?? (timeoutMs != null
    ? {
        sonda: (ip: string, p: number) => sondaPorta(ip, p, { timeoutMs }),
        aperta: (ip: string, p: number) => portaAperta(ip, p, timeoutMs),
        controllo: (ip: string, p: number, opz: { proveFabbrica: boolean; consumaTentativo: () => boolean; tls?: boolean }) =>
          sondaControllo(ip, p, { ...opz, timeoutMs }),
      }
    : STRUMENTI);
  const proveFabbrica = opzioni.proveFabbrica === true;
  const stato: StatoGiro = { inCorso: true, networkId, fase: null, totale: 0, fatte: 0, iniziato: new Date().toISOString(), finito: null, errore: null };
  giri.set(tenant, stato);
  void withTenant(tenant, async () => {
    // Fuori dal giro, come per l'Edge: impianti (IoT, OT, PLC) e host esclusi a mano da una persona.
    let esclusi = new Set<number>();
    const eImpianto = (h: Parameters<typeof eImpiantoPuro>[0] & { host_id: number }): boolean => eImpiantoPuro(h) || esclusi.has(h.host_id);
    try {
      if (!opzioni.strumenti) esclusi = new Set(reti.flatMap((rete) => leggiEsclusi(rete)).map((e) => e.host_id));
      if (opzioni.porteComuni) {
        const candidati =
          opzioni.porteComuni === "rete" ? (networkId ? getHostServiziDellaRete(networkId) : []) : getHostSenzaPorteServizi();
        const host = candidati.filter((h) => !eImpianto(h));
        const elenco = (opzioni.porte ?? portePerGiro()).filter((porta) => !daSaltare(porta, null));
        const prove = host.flatMap((h) => elenco.map((porta) => ({ h, porta })));
        stato.fase = "porte";
        stato.totale = prove.length;
        stato.fatte = 0;
        const trovate = new Map<number, number[]>();
        await inParallelo(prove, parallelePorte, async ({ h, porta }) => {
          let si = false;
          try {
            si = await aperta(h.ip, porta);
          } catch {
            si = false;
          }
          if (si) trovate.set(h.host_id, [...(trovate.get(h.host_id) ?? []), porta]);
          stato.fatte += 1;
        });
        for (const h of host) {
          const porte = (trovate.get(h.host_id) ?? []).sort((a, b) => a - b);
          registraPorteAperteServizi(h.host_id, porte);
          segnaHostProvatoServizi(h.host_id, elenco.length, porte.length);
        }
      }
      for (const rete of reti) allineaServiziRete(rete);
      const coda = reti.flatMap((rete) => getPorteServiziDaSondare(rete)).filter((p) => !daSaltare(p.porta, null) && !eImpianto(p));
      stato.fase = "sonde";
      riepilogo.host = new Set(coda.map((p) => p.host_id)).size;
      riepilogo.sondati = coda.length;
      stato.totale = coda.length;
      stato.fatte = 0;
      await inParallelo(coda, parallele, async (p) => {
        let esito: EsitoSonda | null = null;
        try {
          esito = await sonda(p.ip, p.porta);
        } catch {
          esito = null; // un errore di rete è «non risponde», non ferma il giro
        }
        salvaEsitoSondaServizio(p.host_id, p.porta, esito);
        if (esito) riepilogo.risposte += 1;
        stato.fatte += 1;
      });
      // UDP di protocollo (DNS, NTP, NetBIOS, SQL Browser): una domanda per protocollo agli host
      // che hanno già un servizio noto. Nmap sull'UDP dice solo «aperta», qui si legge la risposta.
      const udp = opzioni.strumenti ? opzioni.strumenti.udp : STRUMENTI.udp;
      if (udp) {
        const hostUdp = [...new Map(coda.map((p) => [p.host_id, p.ip])).entries()];
        stato.totale += hostUdp.length;
        await inParallelo(hostUdp, parallele, async ([hostId, ip]) => {
          try {
            for (const e of await udp(ip)) salvaSondaUdpServizio(hostId, e);
          } catch {
            // un host muto sull'UDP non ferma il giro
          }
          stato.fatte += 1;
        });
      }
      if (controllo) {
        const extra = reti.flatMap((rete) => getPorteServiziDaControllare(rete, PORTE_CONTROLLO, true))
          .filter((p) => !daSaltare(p.porta, null) && !eImpianto(p) && p.protocollo === protocolloControllo(p.porta));
        const restanti = new Map<string, number>();
        stato.totale += extra.length;
        riepilogo.controlli = extra.length;
        await inParallelo(extra, parallele, async (p) => {
          let esito: EsitoSondaControllo;
          // Freno sulla sessione SMB anonima e «Guest» (10/11/2026): la prova lascia due accessi
          // rifiutati nel registro del server a ogni giro, e il giro riparte dopo ogni Discovery.
          // Sull'hub in un giorno 196 accessi «Guest» rifiutati sui due DC, che la sera hanno smesso
          // di rispondere all'hub (probabile XDR). L'esito non cambia da un'ora all'altra: una volta
          // ogni SMB_ANONIMO_OGNI_GIORNI per host basta. I login di fabbrica chiesti a mano passano.
          const eSmb = p.porta === 445 || p.porta === 139;
          if (eSmb && !proveFabbrica && smbProvatoDiRecente(tenant, p.host_id, p.porta)) {
            stato.fatte += 1;
            return;
          }
          try {
            esito = await controllo(p.ip, p.porta, {
              proveFabbrica,
              tls: Boolean(p.tls),
              consumaTentativo: () => {
                const budget = restanti.get(p.ip) ?? TETTO_FABBRICA_PER_HOST;
                if (!proveFabbrica || budget <= 0) return false;
                restanti.set(p.ip, budget - 1);
                return true;
              },
            });
          } catch {
            esito = { info: null, tentativiUsati: 0 };
          }
          if (esito.info) salvaControlloServizioRete(p.host_id, p.porta, p.protocollo, esito.info);
          if (eSmb) segnaSmbProvato(tenant, p.host_id, p.porta);
          stato.fatte += 1;
        });
      }
      if (opzioni.conCredenziali) {
        const voci = reti.flatMap((rete) => getCredenzialiValidateServizi(rete)).filter((v) => !eImpianto(v));
        // SNMP: nessun traffico, il rilievo viene dal registro (community validata = gestione in chiaro).
        for (const v of voci) {
          if (v.protocol_type === "snmp" && !v.auth_protocol) salvaControlloServizioRete(v.host_id, v.port, "udp", { snmp_community_gestione: true });
        }
        // SSH: una credenziale per host (la prima validata), una sessione, un comando di sola lettura.
        const visti = new Set<number>();
        const ssh = voci.filter((v) => v.protocol_type === "ssh" && eShellPosix(v.banner) && !visti.has(v.host_id) && visti.add(v.host_id));
        const esegui = opzioni.strumenti?.ssh ?? (async (o) => (await runSshCommand({ ...o, command: COMANDO_SSH, timeoutSec: 20 })).stdout);
        stato.fase = "credenziali";
        stato.totale += ssh.length;
        await inParallelo(ssh, 4, async (v) => {
          try {
            const a = accessoSshCredenziale(v.credential_id);
            // Il ponte SSH prende utente e password: le voci a chiave qui non si usano.
            if (a.ok && a.accesso.password) {
              const info = leggiUscitaSsh(await esegui({ host: v.ip, port: v.port, username: a.accesso.username, password: a.accesso.password }));
              if (info) {
                salvaControlloServizioRete(v.host_id, v.port, "tcp", { auth_ssh: info });
                riepilogo.conCredenziali += 1;
              }
            }
          } catch (e) {
            // Nessun secondo tentativo: un rifiuto si conta e si dice, niente IP né segreti nel log.
            if (eRifiutoSsh(e instanceof Error ? e.message : "")) {
              riepilogo.credRifiutate += 1;
              console.warn(`[servizi-rete] host #${v.host_id}: la credenziale SSH validata è stata rifiutata, non riprovo`);
            }
          }
          stato.fatte += 1;
        });
      }
      raccogliIdentita();
      riempiOsVuotiServizi();
    } catch (e) {
      stato.errore = e instanceof Error ? e.message : String(e);
      console.error(`[servizi-rete] giro fallito per ${tenant}:`, e);
    } finally {
      stato.inCorso = false;
      stato.fase = null;
      stato.finito = new Date().toISOString();
      if (opzioni.alTermine) {
        riepilogo.durataMs = Date.now() - partenza;
        riepilogo.errore = stato.errore;
        try {
          opzioni.alTermine(riepilogo);
        } catch (e) {
          console.error(`[servizi-rete] riepilogo non scritto per ${tenant}:`, e instanceof Error ? e.message : "errore");
        }
      }
      const coda = codeDiscovery.get(tenant);
      const prossima = coda?.entries().next().value;
      if (coda && prossima) {
        const [chiave, avvia] = prossima;
        coda.delete(chiave);
        if (coda.size === 0) codeDiscovery.delete(tenant);
        avvia();
      }
    }
  });
  return true;
}
