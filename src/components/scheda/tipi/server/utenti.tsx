"use client";

/**
 * Tab «Utenti»: chi è collegato ora, ultimo accesso, profili sul sistema (con i dati AD) e utenti locali.
 * `user_profiles`, `last_logged_on_user` erano solo nella pagina /devices; utenti locali e collegati stavano
 * in Dettagli > Sistema > «Storage, servizi e utenti».
 */
import { cn } from "@/lib/utils";
import { Campo } from "../../blocchi";
import type { ContestoScheda } from "../../contesto";
import { Riquadro } from "../../riquadro";
import { Nessun, dataBreve, dataOra, infoDi, td, th } from "./dati-server";

type Sessione = NonNullable<NonNullable<ReturnType<typeof infoDi>>["logged_on_users"]>[number];

/** Sessioni collegate, una per riga (per la Panoramica e la tab). */
export function ElencoSessioni({ sessioni, max }: { sessioni: Sessione[]; max?: number }) {
  const mostrate = sessioni.slice(0, max ?? sessioni.length);
  return (
    <ul className="space-y-1.5 text-[13px]">
      {mostrate.map((u, i) => (
        <li key={`${u.username}-${i}`} className="flex items-baseline gap-3">
          <span className="min-w-0 truncate font-mono font-semibold" title={u.username}>{u.username ?? "?"}</span>
          <span className="ml-auto shrink-0 text-muted-foreground">
            {[u.session_type, u.logon_time ? `da ${dataOra(u.logon_time)}` : null].filter(Boolean).join(" · ")}
          </span>
        </li>
      ))}
      {sessioni.length > mostrate.length && <li className="text-muted-foreground">… altri {sessioni.length - mostrate.length}</li>}
    </ul>
  );
}

export function UtentiServer({ ctx }: { ctx: ContestoScheda }) {
  const di = infoDi(ctx);
  const sessioni = di?.logged_on_users ?? [];
  const profili = di?.user_profiles ?? [];
  const locali = di?.local_users ?? [];
  const ultimo = di?.last_logged_on_user ?? null;
  if (sessioni.length === 0 && profili.length === 0 && locali.length === 0 && !ultimo) {
    return <Nessun>La scansione non ha letto utenti né sessioni: usa «Aggiorna» per leggerli.</Nessun>;
  }
  const th2 = th;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Riquadro titolo={`Collegati ora (${sessioni.length})`} vuoto={sessioni.length === 0 && !ultimo}>
          {ultimo && <dl className="mb-3"><Campo label="Ultimo accesso" value={ultimo} mono /></dl>}
          {sessioni.length > 0 ? <ElencoSessioni sessioni={sessioni} /> : <p className="text-[13px] text-muted-foreground">Nessuna sessione aperta in questo momento.</p>}
        </Riquadro>
        <Riquadro titolo={`Utenti locali (${locali.length})`} vuoto={locali.length === 0}>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
            {locali.map((u, i) => (
              <li key={`${u.name}-${i}`} title={u.full_name ?? u.name ?? ""} className={cn("font-mono", u.disabled && "text-muted-foreground line-through")}>
                {u.name ?? "?"}{u.disabled && <span className="font-sans no-underline"> (disabilitato)</span>}
              </li>
            ))}
          </ul>
        </Riquadro>
      </div>
      <Riquadro titolo={`Profili sul sistema (${profili.length})`} vuoto={profili.length === 0}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr><th className={th2}>Utente</th><th className={th2}>Reparto · ruolo</th><th className={th2}>Email</th><th className={th2}>Ultimo uso</th><th className={th2}>Ultimo login AD</th></tr></thead>
            <tbody>
              {profili.map((p, i) => (
                <tr key={`${p.username}-${i}`}>
                  <td className={td}>
                    <span className="font-semibold">{p.loaded && <span aria-hidden>✓ </span>}{p.ad_display_name || p.username}</span>
                    {p.ad_display_name && p.username && p.ad_display_name !== p.username && <span className="font-mono text-muted-foreground"> ({p.username})</span>}
                    {p.ad_enabled === false && <span className="ml-2 font-semibold text-[#8E1B20] dark:text-[#E8625A]"><span aria-hidden>✕ </span>disabilitato</span>}
                  </td>
                  <td className={td}>{[p.ad_department, p.ad_title].filter(Boolean).join(" · ")}</td>
                  <td className={`${td} text-muted-foreground`}>{p.ad_email ?? ""}</td>
                  <td className={td}>{dataBreve(p.last_use) ?? ""}</td>
                  <td className={td}>{dataOra(p.ad_last_logon) ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">✓ = profilo caricato (utente collegato).</p>
      </Riquadro>
    </div>
  );
}
