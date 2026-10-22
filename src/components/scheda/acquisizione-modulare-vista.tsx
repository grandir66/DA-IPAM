"use client";

/**
 * Riquadro «Acquisizione modulare (anteprima)» della tab Gestione, sotto «Credenziali» (tavola C1 del 22/10 con le
 * correzioni del piano §7): è l'acquisizione normale dell'apparato con un altro formato, quindi niente pulsante proprio:
 * si acquisisce con «Aggiorna» in alto. Mostra l'ultimo snapshot (stato, collector, credenziali per nome), cosa è
 * cambiato nell'apparato, la tabella delle sezioni con avvisi e prime 5 righe, le ultime acquisizioni. Solo
 * presentazione: i dati li carica `acquisizione-modulare.tsx`. Stati per segno e luminanza (`stile-stato-modulo.ts`).
 */
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { STILE_STATO, type ToniStato } from "@/components/shared/stile-stato-modulo";
import { parseDbDate } from "@/lib/db-date";

export interface SezioneVista {
  chiave: string;
  nome: string;
  stato: string;
  righe: number;
  fonti: string[];
  avvisi: Array<{ codice: string; testo: string | null }>;
  colonne: string[];
  prime: Array<Array<string | number | null>>;
}

export interface ModificaVista { destinazione: string; chiave: string; campo: string; prima: string | null; dopo: string | null; esito: string }

export interface StatoAcquisizione {
  accesa: boolean;
  in_corso: boolean;
  fonte: { esito: string; collector: string | null; possibili: string[]; credenziali: Record<string, string>; scelta: string | null; richieste: string[] };
  descrittore: { id: string; versione: string; prodotti: readonly string[]; collaudo: string; collaudati: ReadonlyArray<{ modello: string; firmware: string }> } | null;
  disponibili: string[];
  snapshot: {
    id: number; collector: string; collector_version: string; status: string; finished_at: string; duration_ms: number;
    requested_by_name: string | null; credenziali: Record<string, string>; sezioni: SezioneVista[]; modifiche: { righe: ModificaVista[]; totale: number };
  } | null;
  storico: { righe: Array<{ id: number; status: string; finished_at: string; duration_ms: number; payload_bytes: number; sha256: string; collector: string }>; totale: number; pagina: number; per_pagina: number };
}

const TONO: Record<string, ToniStato> = { ok: "ok", partial: "attenzione", error: "guasto", skipped: "da_verificare", unsupported: "grigio" };
const PAROLA: Record<string, string> = { ok: "Letta", partial: "Parziale", error: "Errore", skipped: "Saltata", unsupported: "Non supportata" };

export function ChipStato({ stato }: { stato: string }) {
  const s = STILE_STATO[TONO[stato] ?? "grigio"];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[13px] font-semibold ${s.classi}`}>
      <span aria-hidden>{s.segno}</span>
      {PAROLA[stato] ?? stato}
    </span>
  );
}

const quando = (iso: string): string => parseDbDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const secondi = (ms: number): string => `${(ms / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} s`;
const peso = (b: number): string => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const PROTOCOLLO: Record<string, string> = { ssh: "SSH", snmp: "SNMP", api: "API", winrm: "WinRM" };
const DOVE: Record<string, string> = { apparato: "Apparato", host: "Host", porte: "Porta", vicini: "Vicino", inventario: "Inventario" };
const ESITO: Record<string, string> = { scritto: "aggiornato", aggiunta: "aggiunta", tolta: "tolta", manuale: "lasciato: scritto a mano" };

/** Azione testuale: navy sottolineato (il cian non va mai sul testo, brand Domarc). */
function Azione({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="text-[13px] font-medium text-[#0D2537] underline underline-offset-2 hover:no-underline dark:text-foreground">{children}</button>;
}

function Credenziali({ c }: { c: Record<string, string> }) {
  const voci = Object.entries(c);
  if (voci.length === 0) return <span className="text-muted-foreground">nessuna</span>;
  return <>{voci.map(([p, nome], i) => <Fragment key={p}>{i > 0 && " · "}{PROTOCOLLO[p] ?? p} «{nome}»</Fragment>)}</>;
}

function Collector({ d }: { d: NonNullable<StatoAcquisizione["descrittore"]> }) {
  return (
    <span>
      <span className="font-mono font-semibold">{d.id} {d.versione}</span>{" "}
      {d.collaudo === "collaudato" ? (
        <span className="text-muted-foreground">✓ collaudato su {d.collaudati.map((c) => c.modello).join(" e ")}</span>
      ) : (
        <span className="rounded border border-dashed border-slate-400 px-1 text-muted-foreground">non collaudato</span>
      )}
    </span>
  );
}

/** Stati vuoti e caso dubbio (oggetti 10-13 e 15): una frase che dice cosa fare. */
function Avviso({ segno, children }: { segno: string; children: React.ReactNode }) {
  return (
    <p className="flex gap-2 text-sm">
      <span aria-hidden className="font-semibold">{segno}</span>
      <span>{children}</span>
    </p>
  );
}

function Modifiche({ m }: { m: { righe: ModificaVista[]; totale: number } }) {
  const [tutte, setTutte] = useState(false);
  if (m.totale === 0) return <p className="text-sm text-muted-foreground">Nessun cambiamento: l&apos;apparato era già come lo ha letto il collector.</p>;
  const righe = tutte ? m.righe : m.righe.slice(0, 8);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[13px] text-muted-foreground">
            <tr><th className="py-1 pr-3 font-semibold">Dove</th><th className="py-1 pr-3 font-semibold">Campo</th><th className="py-1 pr-3 font-semibold">Prima</th><th className="py-1 pr-3 font-semibold">Dopo</th><th className="py-1 font-semibold">Esito</th></tr>
          </thead>
          <tbody>
            {righe.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="py-1 pr-3">{DOVE[r.destinazione] ?? r.destinazione} <span className="font-mono">{r.destinazione === "host" ? "" : r.chiave}</span></td>
                <td className="py-1 pr-3 font-mono">{r.campo}</td>
                <td className="py-1 pr-3 font-mono text-muted-foreground">{r.prima ?? "—"}</td>
                <td className="py-1 pr-3 font-mono">{r.dopo ?? "—"}</td>
                <td className="py-1">{r.esito === "manuale" ? <span className="font-semibold">▲ {ESITO[r.esito]}</span> : ESITO[r.esito] ?? r.esito}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {m.totale > 8 && (
        <Azione onClick={() => setTutte(!tutte)}>
          {tutte ? "Mostra meno" : m.totale > m.righe.length ? `Mostra le prime ${m.righe.length} di ${m.totale}` : `Mostra tutte (${m.totale})`}
        </Azione>
      )}
    </div>
  );
}

function Sezioni({ sezioni }: { sezioni: SezioneVista[] }) {
  const [aperta, setAperta] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[13px] text-muted-foreground">
          <tr><th className="py-1 pr-3 font-semibold">Sezione</th><th className="py-1 pr-3 font-semibold">Stato</th><th className="py-1 pr-3 text-right font-semibold">Righe</th><th className="py-1 pr-3 font-semibold">Fonti</th><th className="py-1 font-semibold">Avvisi</th></tr>
        </thead>
        <tbody>
          {sezioni.map((s) => {
            const apri = aperta === s.chiave;
            const apribile = s.avvisi.length > 0 || s.prime.length > 0;
            return (
              <Fragment key={s.chiave}>
                <tr className="border-t align-middle">
                  <td className="py-1.5 pr-3 font-medium">{s.nome}</td>
                  <td className="py-1.5 pr-3"><ChipStato stato={s.stato} /></td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{s.righe.toLocaleString("it-IT")}</td>
                  <td className="py-1.5 pr-3 font-mono text-[13px]">{s.fonti.join(" · ") || "—"}</td>
                  <td className="py-1.5">
                    {apribile ? (
                      <button type="button" className="text-[13px] font-medium text-[#0D2537] underline-offset-2 hover:underline dark:text-foreground" aria-expanded={apri} onClick={() => setAperta(apri ? null : s.chiave)}>
                        {s.avvisi.length > 0 ? `${s.avvisi.length} ${s.avvisi.length === 1 ? "avviso" : "avvisi"}` : "righe lette"} {apri ? "▾" : "▸"}
                      </button>
                    ) : "—"}
                  </td>
                </tr>
                {apri && (
                  <tr>
                    <td colSpan={5} className="bg-muted/30 px-3 py-2">
                      {s.avvisi.map((a) => (
                        <p key={a.codice} className="text-sm">{a.testo ?? "Avviso del collector."} <span className="font-mono text-[12px] text-muted-foreground">{a.codice}</span></p>
                      ))}
                      {s.prime.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[13px] font-semibold text-muted-foreground">Prime righe lette (sola lettura, {s.prime.length} di {s.righe.toLocaleString("it-IT")})</p>
                          <table className="mt-1 text-[13px]">
                            <thead><tr>{s.colonne.map((c) => <th key={c} className="pr-4 text-left font-semibold">{c}</th>)}</tr></thead>
                            <tbody>{s.prime.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="pr-4 font-mono">{v === null ? "—" : String(v)}</td>)}</tr>)}</tbody>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function VistaAcquisizioneModulare({ stato, isAdmin, onVedi, onScegliFonte, onPagina, urlScarica }: {
  stato: StatoAcquisizione;
  isAdmin: boolean;
  onVedi: (id: number) => void;
  onScegliFonte: () => void;
  onPagina: (n: number) => void;
  urlScarica: (id: number) => string;
}) {
  const { fonte, snapshot: s, descrittore: d } = stato;
  const pagine = Math.max(1, Math.ceil(stato.storico.totale / stato.storico.per_pagina));
  return (
    <div className="space-y-4">
      {!stato.accesa && (
        <Avviso segno="▲">L&apos;acquisizione modulare è spenta per questa installazione: «Aggiorna» usa l&apos;acquisizione di sempre. Un amministratore la accende in Impostazioni → Sistema.</Avviso>
      )}
      {fonte.esito === "nessun_collector" && (
        <Avviso segno="–">Per questo apparato non esiste un collector: si usa l&apos;acquisizione di sempre. Quelli disponibili sono: {stato.disponibili.join(", ")}.</Avviso>
      )}
      {fonte.esito === "classica_scelta" && (
        <Avviso segno="●">Scelta a mano l&apos;acquisizione di sempre per questo apparato.{isAdmin && <> <Azione onClick={onScegliFonte}>Cambia</Azione></>}</Avviso>
      )}
      {fonte.esito === "dubbio" && (
        <Avviso segno="▲">
          {fonte.possibili.length > 1 && fonte.richieste.length === 0
            ? <>Questo apparato può essere letto da {fonte.possibili.join(" o da ")}: serve una scelta prima di acquisire.</>
            : <>{fonte.collector} vuole una credenziale {fonte.richieste.map((p) => PROTOCOLLO[p] ?? p).join(" o ")} assegnata all&apos;apparato e non ce n&apos;è: assegnala nella tabella «Credenziali» qui sopra, oppure scegli l&apos;acquisizione di sempre.</>}
          {isAdmin && <> <Button variant="outline" size="sm" className="ml-1" onClick={onScegliFonte}>Scegli la fonte</Button></>}
        </Avviso>
      )}

      {(fonte.esito === "pronta" || d) && (
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-[13px] font-semibold text-muted-foreground">Collector</dt>
          <dd>{d ? <Collector d={d} /> : "—"}{fonte.scelta && fonte.scelta !== "classica" && <span className="text-muted-foreground"> · scelto a mano</span>}{isAdmin && fonte.possibili.length > 1 && fonte.esito === "pronta" && <> <Azione onClick={onScegliFonte}>Cambia</Azione></>}</dd>
          <dt className="text-[13px] font-semibold text-muted-foreground">Credenziali</dt>
          <dd><Credenziali c={s?.credenziali && Object.keys(s.credenziali).length ? s.credenziali : fonte.credenziali} /> <span className="text-muted-foreground">— dall&apos;archivio, sola lettura</span></dd>
        </dl>
      )}

      {s ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <ChipStato stato={s.status} />
            <span className="tabular-nums">{quando(s.finished_at)} · {secondi(s.duration_ms)}</span>
            {s.requested_by_name && <span className="text-muted-foreground">richiesta da {s.requested_by_name}</span>}
            {stato.in_corso && <span className="font-semibold">● acquisizione in corso…</span>}
          </div>
          {s.status === "error" && (
            <Avviso segno="✕">Lettura non riuscita. Non provo altre credenziali da solo: correggi o scegli la credenziale nella tabella qui sopra e premi di nuovo «Aggiorna».</Avviso>
          )}
          <section className="space-y-2">
            <h4 className="text-[13px] font-bold uppercase tracking-wider text-[#0D2537] dark:text-foreground">Cosa è cambiato nell&apos;apparato</h4>
            {s.status === "error" ? <p className="text-sm text-muted-foreground">Niente: da una lettura in errore non si scrive.</p> : <Modifiche m={s.modifiche} />}
            <p className="text-[13px] text-muted-foreground">Una sezione parziale aggiunge e aggiorna, non toglie; un valore scritto a mano resta.</p>
          </section>
          <section className="space-y-2">
            <h4 className="text-[13px] font-bold uppercase tracking-wider text-[#0D2537] dark:text-foreground">Sezioni lette</h4>
            <Sezioni sezioni={s.sezioni} />
          </section>
        </>
      ) : (
        fonte.esito === "pronta" && (
          <Avviso segno="●">Mai acquisito con il collector. Premi «Aggiorna» in alto per la prima lettura{stato.accesa ? "" : " (dopo aver acceso l'acquisizione modulare)"}.</Avviso>
        )
      )}

      {stato.storico.totale > 0 && (
        <section className="space-y-2">
          <h4 className="text-[13px] font-bold uppercase tracking-wider text-[#0D2537] dark:text-foreground">Ultime acquisizioni</h4>
          <p className="text-[13px] text-muted-foreground">Si tengono le ultime 20, più la prima e l&apos;ultima riuscita.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[13px] text-muted-foreground">
                <tr><th className="py-1 pr-3 font-semibold">Quando</th><th className="py-1 pr-3 font-semibold">Esito</th><th className="py-1 pr-3 text-right font-semibold">Durata</th><th className="py-1 pr-3 text-right font-semibold">Peso</th><th className="py-1 pr-3 font-semibold">Impronta</th><th className="py-1" /></tr>
              </thead>
              <tbody>
                {stato.storico.righe.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-1 pr-3 tabular-nums">{quando(r.finished_at)}</td>
                    <td className="py-1 pr-3"><ChipStato stato={r.status} /></td>
                    <td className="py-1 pr-3 text-right tabular-nums">{secondi(r.duration_ms)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{peso(r.payload_bytes)}</td>
                    <td className="py-1 pr-3 font-mono text-[13px]">{r.sha256}</td>
                    <td className="py-1 whitespace-nowrap text-right">
                      {s?.id === r.id ? <span className="text-[13px] font-semibold">In vista</span> : <Azione onClick={() => onVedi(r.id)}>Vedi</Azione>}
                      {isAdmin && <> · <a className="text-[13px] font-medium underline-offset-2 hover:underline" href={urlScarica(r.id)}>Scarica JSON</a></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagine > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={stato.storico.pagina <= 1} onClick={() => onPagina(stato.storico.pagina - 1)}>‹ Più recenti</Button>
              <span className="tabular-nums">Pagina {stato.storico.pagina} di {pagine}</span>
              <Button variant="outline" size="sm" disabled={stato.storico.pagina >= pagine} onClick={() => onPagina(stato.storico.pagina + 1)}>Meno recenti ›</Button>
            </div>
          )}
        </section>
      )}
      <p className="text-[13px] text-muted-foreground">Si acquisisce con «Aggiorna» in alto: per gli apparati che hanno un collector la lettura arriva in questo formato e popola l&apos;apparato. Nessuna scrittura sull&apos;apparato.</p>
    </div>
  );
}
