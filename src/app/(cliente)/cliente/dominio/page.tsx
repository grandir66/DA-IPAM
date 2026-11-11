import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { Barra } from "@/components/cliente/barra";
import { PaginaModulo } from "@/components/cliente/pagina-modulo";
import { Pannello, TesseraNumero, Vuoto } from "@/components/shared/console";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { contestoCliente, nelCliente } from "@/lib/cliente/contesto";
import {
  problemiDiAccesso,
  schedaDominio,
  statoDominio,
  type ProblemaAccesso,
  type StatoDominio,
} from "@/lib/cliente/schede/dominio";
import type { Gravita } from "@/lib/cliente/registro";
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";

function parametro(v: string | string[] | undefined): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function dataOraItaliana(raw: string | null): string | null {
  if (!raw) return null;
  const data = parseDbDate(raw);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleString("it-IT", {
    timeZone: FUSO_UTENTI,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function Segno({ gravita }: { gravita: Gravita }) {
  if (gravita === "grave") {
    return (
      <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md ${STILE_STATO.guasto.classi}`}>
        <TriangleAlert className="size-4" aria-hidden />
      </span>
    );
  }
  if (gravita === "attenzione") {
    return (
      <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md ${STILE_STATO.attenzione.classi}`}>
        <CircleAlert className="size-4" aria-hidden />
      </span>
    );
  }
  return (
    <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md ${STILE_STATO.da_verificare.classi}`}>
      <Info className="size-4" aria-hidden />
    </span>
  );
}

function BarraRischio({ valore }: { valore: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <Barra valore={valore} massimo={100} />
      </div>
      <span className="w-9 text-right font-mono text-[13px] font-bold">{valore}</span>
    </div>
  );
}

function testoProblema(problema: ProblemaAccesso): string {
  if (problema.tipo === "bloccato") {
    const volte = problema.quanti === 1 ? "1 volta" : `${problema.quanti} volte`;
    return `${problema.utente} · bloccato ${volte}`;
  }
  const tentativi = problema.quanti === 1 ? "1 tentativo fallito" : `${problema.quanti} tentativi falliti`;
  return `${problema.utente} · ${tentativi}`;
}

/** /cliente/dominio?rilievo=<indice> */
export default async function PaginaDominio({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const c = await contestoCliente();
  if (!(await schedaDominio.attiva(c))) redirect("/cliente");
  const q = await searchParams;
  const indice = Number(parametro(q.rilievo));

  let stato: StatoDominio | null = null;
  let problemi: ProblemaAccesso[] = [];
  let statoRotto = false;
  let accessiRotti = false;
  try {
    stato = nelCliente(c, (db) => statoDominio(db));
  } catch (e) {
    statoRotto = true;
    console.error("[cliente] dominio:", e instanceof Error ? e.message : String(e));
  }
  try {
    problemi = nelCliente(c, (db) => problemiDiAccesso(db));
  } catch (e) {
    accessiRotti = true;
    console.error("[cliente] accessi:", e instanceof Error ? e.message : String(e));
  }

  const quando = dataOraItaliana(stato?.controllatoIl ?? null);
  const rilievo = stato && Number.isInteger(indice) ? stato.rilievi[indice] ?? null : null;

  return (
    <PaginaModulo titolo="Dominio e accessi" contesto={quando ? `controllo del ${quando}` : undefined}>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Pannello titolo="Stato del dominio" sottotitolo="più alto è peggio">
          {statoRotto ? (
            <p className="text-sm">Dato non disponibile</p>
          ) : stato ? (
            <div className="space-y-3">
              <TesseraNumero
                titolo="Rischio del dominio"
                valore={stato.punteggio}
                qualifica={stato.unMeseFa == null ? "su 100" : `su 100 · un mese fa ${stato.unMeseFa}`}
              />
              {stato.aree.map((area) => (
                <div key={area.nome} className="space-y-1">
                  <p className="text-sm">{area.nome}</p>
                  <BarraRischio valore={area.punteggio} />
                </div>
              ))}
            </div>
          ) : (
            <Vuoto titolo="Il controllo del dominio non è ancora stato eseguito" />
          )}
        </Pannello>
        <div className="space-y-4">
          {stato && (
            <Pannello titolo="Cosa abbassa il punteggio">
              {stato.rilievi.length > 0 ? (
                <ul>
                  {stato.rilievi.map((voce, i) => (
                    <li key={`${voce.testo}-${i}`} className="border-b py-2 last:border-b-0">
                      <div className="flex items-center gap-2 text-sm">
                        <Segno gravita={voce.gravita} />
                        <span className="min-w-0 flex-1">
                          {voce.quanti} · {voce.testo}
                        </span>
                        <Link
                          href={`/cliente/dominio?rilievo=${i}`}
                          className="shrink-0 text-[13px] text-cian-testo hover:underline"
                          aria-current={rilievo === voce ? "true" : undefined}
                        >
                          vedi i nomi
                        </Link>
                      </div>
                      {rilievo === voce && voce.nomi.length > 0 && (
                        <ul className="mt-1 ml-7">
                          {voce.nomi.map((nome) => (
                            <li key={nome} className="text-sm">{nome}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nessun rilievo in questo controllo</p>
              )}
            </Pannello>
          )}
          <Pannello titolo="Problemi di accesso · ultime 24 ore">
            {accessiRotti ? (
              <p className="text-sm">Dato non disponibile</p>
            ) : problemi.length === 0 ? (
              <p className="text-sm">Nessun problema di accesso nelle ultime 24 ore</p>
            ) : (
              <ul>
                {problemi.map((problema) => {
                  const ora = dataOraItaliana(problema.ultima);
                  const da = problema.da ? `da ${problema.da}` : null;
                  const destra = [da, ora ? `ultima ${ora}` : null].filter(Boolean).join(" · ");
                  return (
                    <li key={`${problema.utente}-${problema.tipo}`} className="border-b py-2 last:border-b-0">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0">{testoProblema(problema)}</span>
                        {destra && <span className="shrink-0 text-[13px] text-muted-foreground">{destra}</span>}
                      </div>
                      {problema.motivo && <p className="text-[13px] text-muted-foreground">{problema.motivo}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Pannello>
        </div>
      </div>
    </PaginaModulo>
  );
}
