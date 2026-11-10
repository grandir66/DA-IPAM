/**
 * I rilievi di UNA riga di `servizi_rete`: certificato, NTLM, SSH, HTTP, porta in chiaro e
 * controlli del giro. Una copia sola: la usano l'elenco Findings (`unione.ts`) e la pagina
 * «Servizi di rete», che li mostra sotto la porta da cui nascono (10/11/2026). Funzione pura.
 */
import {
  controlloDaJson,
  httpDaJson,
  ntlmDaJson,
  protocolloControllo,
  rilieviDaControllo,
  rilieviDaHttp,
  rilieviDaNtlm,
  rilieviDaPorta,
  rilieviDaSsh,
  sshDaJson,
} from "./controlli";
import { rilieviDaTls, tlsDaJson } from "./da-servizi";
import type { RilievoUnito } from "./tipi";

export interface ServizioPerRilievi {
  host_id: number;
  porta: number;
  protocollo: string;
  tls_json: string | null;
  ntlm_json: string | null;
  ssh_json: string | null;
  http_json: string | null;
  controllo_json: string | null;
  ip: string;
  hostname: string | null;
  network_id: number | null;
  network_name: string | null;
}

export function rilieviDelServizio(r: ServizioPerRilievi): RilievoUnito[] {
  const ctx = {
    host_id: r.host_id,
    ip: r.ip,
    hostname: r.hostname,
    network_id: r.network_id,
    network_name: r.network_name,
    porta: r.porta,
    protocollo: r.protocollo,
  };
  const out: RilievoUnito[] = [];
  const tls = tlsDaJson(r.tls_json);
  if (tls) out.push(...rilieviDaTls(tls, ctx));
  out.push(...rilieviDaNtlm(ntlmDaJson(r.ntlm_json), ctx));
  out.push(...rilieviDaSsh(sshDaJson(r.ssh_json), ctx));
  out.push(...rilieviDaHttp(httpDaJson(r.http_json), ctx));
  if (r.protocollo === "tcp") out.push(...rilieviDaPorta(ctx, Boolean(tls)));
  if (r.protocollo === protocolloControllo(r.porta)) out.push(...rilieviDaControllo(controlloDaJson(r.controllo_json), ctx));
  return out;
}
