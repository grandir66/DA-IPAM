"use client";

/**
 * Tab «Active Directory» (solo server con ruolo DC e dati AD): il computer nell'albero AD (OU, sistema, ultimo
 * logon) e i rilievi dell'ultimo controllo. Il controllo completo resta nella pagina Active Directory.
 */
import Link from "next/link";
import { Campo } from "../../blocchi";
import type { ContestoScheda } from "../../contesto";
import { Riquadro } from "../../riquadro";
import { ElencoRilievi, Nessun, dataBreve, dataOra, lnk } from "./dati-server";

export function ActiveDirectoryServer({ ctx }: { ctx: ContestoScheda }) {
  const ad = ctx.ad;
  if (!ad || (!ad.computer && ad.rilievi === null)) return <Nessun>Nessun dato di Active Directory per questo server.</Nessun>;
  const c = ad.computer;
  const alti = (ad.rilievi ?? []).filter((r) => /^(critical|high)$/i.test(r.gravita)).length;
  return (
    <div className="space-y-4">
      <Riquadro titolo="Computer in Active Directory" vuoto={!c}>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Campo label="OU" value={c?.ou} />
          <Campo label="Sistema operativo" value={c?.os} />
          <Campo label="Ultimo logon" value={dataOra(c?.ultimo_logon)} />
          <Campo label="Account"><span><span aria-hidden>{c?.abilitato ? "✓ " : "✕ "}</span>{c?.abilitato ? "abilitato" : "disabilitato"}</span></Campo>
        </dl>
      </Riquadro>
      <Riquadro
        titolo={`Rilievi dell'ultimo controllo${ad.rilievi ? ` (${ad.rilievi.length})` : ""}`}
        azione={<Link href="/active-directory" className={lnk}>controllo AD completo ›</Link>}
      >
        {ad.rilievi === null ? (
          <p className="text-[13px] text-muted-foreground">Nessun controllo di Active Directory completato per questo dominio.</p>
        ) : ad.rilievi.length === 0 ? (
          <p className="text-[13px]"><span aria-hidden>✓ </span>Nessun rilievo nell&apos;ultimo controllo{ad.controllo ? ` (${dataBreve(ad.controllo)})` : ""}.</p>
        ) : (
          <>
            <p className="mb-3 text-[13px] text-muted-foreground">{alti} {alti === 1 ? "alto" : "alti"} · controllo del {dataBreve(ad.controllo)}</p>
            <ElencoRilievi rilievi={ad.rilievi} />
          </>
        )}
      </Riquadro>
    </div>
  );
}
