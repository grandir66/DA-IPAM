"use client";

/**
 * Tab «Rilievi» (Riccardo, 04/11/2026): cosa hanno letto i profili di scansione
 * su questo host, **in tabella, i campi significativi** — non il dump degli
 * `elems` di nmap.
 *
 * La tab c'è solo se l'host ha almeno un rilievo (`haRilievi` in `tabDelTipo`).
 * La lettura la fa il server (`campiDaRilievi`), che riusa la stessa funzione
 * con cui il profilo riempie le colonne dell'host: la tabella non può dire una
 * cosa diversa da quella che è stata scritta.
 */
import { Riquadro } from "./riquadro";
import type { ContestoScheda } from "./contesto";
import { oraBreve } from "./librenms-pezzi";
import type { FonteCampo, RispostaRilieviProfilo } from "@/lib/scanner/profili/campi-scheda";

const th = "px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground whitespace-nowrap";

const NOME_PROFILO: Record<string, string> = { approfondito: "Approfondito", iot_ot: "IoT / OT" };

/** «s7-info · tcp/102» — dove il valore è stato letto. */
function dove(f: FonteCampo): string {
  if (f.porta === null) return f.script;
  return `${f.script} · ${f.protocollo ?? "tcp"}/${f.porta}`;
}

export function TabRilievi({ ctx }: { ctx: ContestoScheda }) {
  const d: RispostaRilieviProfilo | null = ctx.rilieviProfilo;
  if (!d || d.totale === 0) {
    return <p className="text-sm text-muted-foreground">Nessun rilievo: su questo host non è ancora girato un profilo di scansione.</p>;
  }
  const profili = d.profili.map((p) => NOME_PROFILO[p] ?? p).join(" · ");
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">
        Profili di scansione{profili ? ` · ${profili}` : ""} · {d.totale} script con risposta · ultimo rilievo {oraBreve(d.ultimoAt)}
      </p>

      {d.campi.length === 0 ? (
        <p className="text-sm text-muted-foreground">Gli script hanno risposto, ma nessuno ha dato un campo significativo.</p>
      ) : (
        <Riquadro titolo="Campi letti dai profili">
          <div className="-m-4 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b-2 bg-muted/40">
                <tr>
                  <th className={th}>Campo</th>
                  <th className={th}>Valore</th>
                  <th className={th}>Letto da</th>
                  <th className={th}>Quando</th>
                </tr>
              </thead>
              <tbody>
                {d.campi.map((c, i) => (
                  <tr key={`${c.campo}-${i}`} className="border-b align-top">
                    <td className="px-3 py-1.5 whitespace-nowrap font-semibold">{c.etichetta}</td>
                    <td className="px-3 py-1.5 break-all">{c.valore}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap font-mono text-muted-foreground">
                      {dove(c.fonti[0])}
                      {c.fonti.length > 1 && (
                        <span className="ml-1 font-sans" title={c.fonti.slice(1).map(dove).join(", ")}>
                          e altri {c.fonti.length - 1}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{oraBreve(c.fonti[0].at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Riquadro>
      )}

      {d.senzaCampi.length > 0 && (
        <Riquadro titolo="Script senza campi">
          <p className="mb-2 text-[13px] text-muted-foreground">
            Hanno risposto, ma quello che hanno detto non diventa un campo della scheda: la risposta grezza resta salvata.
          </p>
          <div className="-m-4 mt-0 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b-2 bg-muted/40">
                <tr>
                  <th className={th}>Script</th>
                  <th className={th}>Porta</th>
                  <th className={th}>Quando</th>
                </tr>
              </thead>
              <tbody>
                {d.senzaCampi.map((f, i) => (
                  <tr key={`${f.script}-${f.porta}-${i}`} className="border-b">
                    <td className="px-3 py-1.5 whitespace-nowrap font-mono">{f.script}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap font-mono text-muted-foreground">
                      {f.porta === null ? "host" : `${f.protocollo ?? "tcp"}/${f.porta}`}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{oraBreve(f.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Riquadro>
      )}
    </div>
  );
}
