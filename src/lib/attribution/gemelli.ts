import type Database from "better-sqlite3";

/**
 * Gemelli di MAC (Riccardo, 10/11/2026: «ricordare la categoria di un host spento con lo stesso MAC»).
 *
 * Sull'hub 533 un PC che cambia IP in DHCP lascia la riga vecchia: Wazuh e AD si agganciano alla riga
 * nuova, la vecchia perde ogni evidenza e resta senza categoria (19 host su 78). Lo stesso MAC è lo
 * stesso apparecchio: la riga senza categoria prende quella del gemello.
 *
 * Tre freni:
 * - il gemello deve avere una categoria sostenuta da un'evidenza viva **non** `mac_gemello`, altrimenti
 *   due righe si reggerebbero a vicenda per sempre;
 * - i gemelli devono dire tutti la stessa categoria;
 * - un MAC su più di `MAX_RIGHE_STESSO_MAC` righe non è un apparecchio, è un router che risponde per
 *   altri (proxy ARP): niente.
 */
export const MAX_RIGHE_STESSO_MAC = 4;

export interface GemelloDiMac { categoria: string; ip: string }

export function gemelloDiMac(dbh: Database.Database, hostId: number): GemelloDiMac | null {
  const righe = dbh.prepare(
    `SELECT o.ip, o.attr_category AS categoria,
            EXISTS(SELECT 1 FROM attribution_evidence e
                   WHERE e.host_id = o.id AND e.dimension = 'category' AND e.superseded_by IS NULL
                     AND e.source != 'mac_gemello' AND (e.expires_at IS NULL OR e.expires_at > ?)) AS propria
     FROM hosts h JOIN hosts o ON o.mac = h.mac AND o.id != h.id
     WHERE h.id = ? AND h.mac IS NOT NULL AND h.mac != ''`
  ).all(new Date().toISOString(), hostId) as Array<{ ip: string; categoria: string | null; propria: number }>;
  if (righe.length === 0 || righe.length + 1 > MAX_RIGHE_STESSO_MAC) return null;
  const buone = righe.filter((r) => r.categoria && r.propria === 1);
  if (buone.length === 0) return null;
  if (new Set(buone.map((r) => r.categoria)).size !== 1) return null;
  return { categoria: buone[0].categoria as string, ip: buone[0].ip };
}
