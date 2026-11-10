/**
 * Rilievi derivati dalle sonde già salvate (TLS scaduto, proto vecchio, autofirmato).
 * Funzioni pure: la query sta in unione.ts.
 */
import type { InfoTls } from "@/lib/servizi-rete/sonde";
import type { RilievoUnito } from "./tipi";

/** RC4, DES, 3DES, NULL, EXPORT, MD5. AES-GCM/CTR no. */
export function eTlsCifrarioDebole(cipher: string | null): boolean {
  if (!cipher) return false;
  const c = cipher.toUpperCase();
  if (/RC4/.test(c) || /EXPORT/.test(c) || /NULL/.test(c) || /MD5/.test(c) || /IDEA/.test(c)) return true;
  if (/3DES|DES-CBC3|CBC3/.test(c)) return true;
  return /(?:^|[_-])DES(?:$|[_-])/.test(c);
}

/** RSA 512/1024/1536. Non le curve EC (256). */
export function eTlsChiaveDebole(bits: number | null | undefined): boolean {
  return bits === 512 || bits === 1024 || bits === 1536;
}

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
  protocollo?: string;
}

/** Un rilievo TLS di un giro: `id` e `chiaveTriage` coincidono (`giro:<slug>:<host_id>:<porta>`). */
function rigaTls(
  ctx: ContestoServizio,
  idSlug: string,
  gravita: RilievoUnito["gravita"],
  titolo: string,
  prova: string,
  rimedio: string,
): RilievoUnito {
  const chiave = `giro:${idSlug}:${ctx.host_id}:${ctx.porta}`;
  return {
    id: chiave,
    chiaveTriage: chiave,
    fonte: "giro",
    gravita,
    titolo,
    prova,
    rimedio,
    ip: ctx.ip,
    host_id: ctx.host_id,
    network_id: ctx.network_id,
    network_name: ctx.network_name,
    visto: null,
    cve_key: null,
    host_count: 1,
  };
}

export function rilieviDaTls(tls: InfoTls, ctx: ContestoServizio): RilievoUnito[] {
  const dove = `${ctx.ip}:${ctx.porta}`;
  const cn = tls.subject_cn ? `CN ${tls.subject_cn}` : "senza CN";
  const out: RilievoUnito[] = [];
  const scaduto = tls.expired || (tls.not_after != null && Date.parse(tls.not_after) <= Date.now());
  if (scaduto) {
    out.push(
      rigaTls(
        ctx,
        "tls-scaduto",
        "High",
        `Certificato TLS scaduto su ${dove}`,
        `${cn}; valido fino a ${tls.not_after ?? "data ignota"}`,
        "Rinnova il certificato sull'apparato e spegni il servizio se non serve più.",
      ),
    );
  }
  if (eTlsVecchio(tls.version)) {
    out.push(
      rigaTls(
        ctx,
        "tls-vecchio",
        "Medium",
        `TLS vecchio (${tls.version ?? "?"}) su ${dove}`,
        `Protocollo ${tls.version ?? "sconosciuto"}; cifrario ${tls.cipher ?? "—"}`,
        "Lascia solo TLS 1.2 o 1.3. TLS 1.0 e 1.1 si rompono con un attacco in LAN.",
      ),
    );
  }
  if (tls.self_signed && !scaduto) {
    out.push(
      rigaTls(
        ctx,
        "tls-autofirmato",
        "Low",
        `Certificato autofirmato su ${dove}`,
        `${cn}; emesso da ${tls.issuer ?? "sconosciuto"}`,
        "Normale su un pannello interno. Se è un servizio verso gli utenti, metti un certificato dell'azienda.",
      ),
    );
  }
  if (eTlsCifrarioDebole(tls.cipher)) {
    out.push(
      rigaTls(
        ctx,
        "tls-cifrario",
        "Medium",
        `TLS con cifrario debole su ${dove}`,
        `Cifrario ${tls.cipher ?? "—"}`,
        "Lascia solo AES-GCM o ChaCha20. Togli RC4, 3DES, NULL ed EXPORT.",
      ),
    );
  }
  if (eTlsChiaveDebole(tls.key_bits)) {
    out.push(
      rigaTls(
        ctx,
        "tls-chiave",
        "Medium",
        `Chiave TLS debole (${tls.key_bits} bit) su ${dove}`,
        `key_bits ${tls.key_bits} (RSA 512/1024/1536). Le curve EC da 256 bit non si segnalano.`,
        "Usa RSA almeno 2048 bit, o meglio ECDSA P-256 / Ed25519.",
      ),
    );
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
