/**
 * Rilievi derivati dalle sonde già salvate (TLS scaduto, proto vecchio, autofirmato).
 * Funzioni pure: la query sta in unione.ts.
 */
import type { InfoTls } from "@/lib/servizi-rete/sonde";
import type { RilievoUnito } from "./tipi";

/** TLSv1 / 1.0 / 1.1 e SSLv3. TLS 1.2 e 1.3 no. */
export function eTlsVecchio(version: string | null): boolean {
  if (!version) return false;
  const v = version.trim().toUpperCase().replace(/[\s_]/g, "");
  if (v === "SSLV3" || v === "SSL3.0" || v === "SSL3") return true;
  if (v === "TLSV1" || v === "TLS1" || v === "TLSV1.0" || v === "TLS1.0") return true;
  if (v === "TLSV1.1" || v === "TLS1.1") return true;
  return false;
}

export interface ContestoServizio {
  host_id: number;
  ip: string;
  hostname: string | null;
  network_id: number | null;
  network_name: string | null;
  porta: number;
}

export function rilieviDaTls(tls: InfoTls, ctx: ContestoServizio): RilievoUnito[] {
  const dove = `${ctx.ip}:${ctx.porta}`;
  const cn = tls.subject_cn ? `CN ${tls.subject_cn}` : "senza CN";
  const out: RilievoUnito[] = [];
  if (tls.expired) {
    out.push({
      id: `giro:tls-scaduto:${ctx.host_id}:${ctx.porta}`,
      fonte: "giro",
      gravita: "High",
      titolo: `Certificato TLS scaduto su ${dove}`,
      prova: `${cn}; valido fino a ${tls.not_after ?? "data ignota"}`,
      rimedio: "Rinnova il certificato sull'apparato e spegni il servizio se non serve più.",
      ip: ctx.ip,
      host_id: ctx.host_id,
      network_id: ctx.network_id,
      network_name: ctx.network_name,
      visto: tls.not_after,
      cve_key: null,
      host_count: 1,
    });
  }
  if (eTlsVecchio(tls.version)) {
    out.push({
      id: `giro:tls-vecchio:${ctx.host_id}:${ctx.porta}`,
      fonte: "giro",
      gravita: "Medium",
      titolo: `TLS vecchio (${tls.version ?? "?"}) su ${dove}`,
      prova: `Protocollo ${tls.version ?? "sconosciuto"}; cifrario ${tls.cipher ?? "—"}`,
      rimedio: "Lascia solo TLS 1.2 o 1.3. TLS 1.0 e 1.1 si rompono con un attacco in LAN.",
      ip: ctx.ip,
      host_id: ctx.host_id,
      network_id: ctx.network_id,
      network_name: ctx.network_name,
      visto: tls.not_after,
      cve_key: null,
      host_count: 1,
    });
  }
  if (tls.self_signed && !tls.expired) {
    out.push({
      id: `giro:tls-autofirmato:${ctx.host_id}:${ctx.porta}`,
      fonte: "giro",
      gravita: "Low",
      titolo: `Certificato autofirmato su ${dove}`,
      prova: `${cn}; emesso da ${tls.issuer ?? "sconosciuto"}`,
      rimedio: "Normale su un pannello interno. Se è un servizio verso gli utenti, metti un certificato dell'azienda.",
      ip: ctx.ip,
      host_id: ctx.host_id,
      network_id: ctx.network_id,
      network_name: ctx.network_name,
      visto: tls.not_after,
      cve_key: null,
      host_count: 1,
    });
  }
  return out;
}

export function tlsDaJson(grezzo: string | null): InfoTls | null {
  if (!grezzo) return null;
  try {
    const v = JSON.parse(grezzo) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    return {
      version: typeof o.version === "string" ? o.version : null,
      cipher: typeof o.cipher === "string" ? o.cipher : null,
      alpn: typeof o.alpn === "string" ? o.alpn : null,
      subject_cn: typeof o.subject_cn === "string" ? o.subject_cn : null,
      subject: typeof o.subject === "string" ? o.subject : null,
      issuer: typeof o.issuer === "string" ? o.issuer : null,
      sans: Array.isArray(o.sans) ? o.sans.filter((s): s is string => typeof s === "string") : [],
      serial: typeof o.serial === "string" ? o.serial : null,
      not_before: typeof o.not_before === "string" ? o.not_before : null,
      not_after: typeof o.not_after === "string" ? o.not_after : null,
      self_signed: o.self_signed === true,
      expired: o.expired === true,
      key_bits: typeof o.key_bits === "number" ? o.key_bits : null,
      sha256: typeof o.sha256 === "string" ? o.sha256 : null,
    };
  } catch {
    return null;
  }
}
