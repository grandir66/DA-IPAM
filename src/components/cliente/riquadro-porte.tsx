"use client";

/**
 * «Porte di rete» nella striscia in testa alla casa (Riccardo, 11/11/2026): un riquadro come gli altri che non porta a
 * una pagina ma apre un modulo — gli apparati di rete con le porte lette e, per quello scelto, il pannello delle porte,
 * per vedere al volo quali sono libere. Come la griglia degli indirizzi di una rete, ma per le porte. Chiuso non occupa
 * altro spazio che il suo riquadro.
 */
import Link from "next/link";
import { useState } from "react";
import { EthernetPort } from "lucide-react";
import { Legenda } from "@/components/shared/console";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { classePorta, DettaglioPorta } from "@/components/cliente/pannello-porte";
import type { ApparatoConPorte } from "@/lib/cliente/schede/apparati";

const conto = (n: number, uno: string, tanti: string): string => `${n} ${n === 1 ? uno : tanti}`;

export function RiquadroPorte({ apparati }: { apparati: ApparatoConPorte[] }) {
  const [ip, setIp] = useState<string | null>(apparati[0]?.ip ?? null);
  const [porta, setPorta] = useState<number | null>(null);
  const libere = apparati.reduce((n, a) => n + a.libere, 0);
  const totale = apparati.reduce((n, a) => n + a.porte.length, 0);
  const senzaStato = apparati.reduce((n, a) => n + a.senzaStato, 0);
  const scelto = apparati.find((a) => a.ip === ip) ?? null;
  const portaScelta = scelto?.porte.find((p) => p.numero === porta) ?? null;
  const contesto = `${conto(apparati.length, "apparato", "apparati")} · ${conto(totale, "porta letta", "porte lette")}${senzaStato > 0 ? ` · ${senzaStato} senza stato` : ""}`;

  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            title={contesto}
            className="flex min-w-0 flex-col rounded-lg border border-t-[3px] border-t-[var(--vc-cian)] bg-card px-3 py-2 text-left hover:border-primary"
          />
        }
      >
        <span className="flex items-center justify-between gap-2 text-[13px] font-semibold">
          <span className="truncate">Porte di rete</span>
          <EthernetPort className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </span>
        <span className="mt-0.5 font-mono text-2xl font-bold leading-tight tabular-nums">
          {libere}
          <span className="ml-1 font-sans text-[13px] font-normal text-muted-foreground">libere su {totale}</span>
        </span>
        <span className="truncate text-[13px] text-muted-foreground">{contesto}</span>
      </DialogTrigger>
      <DialogContent className="vista-cliente max-h-[88vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Porte di rete</DialogTitle>
          <DialogDescription>
            {conto(libere, "porta libera", "porte libere")} su {totale}, all&apos;ultima lettura di ogni apparato.
            {senzaStato > 0 && ` Di ${senzaStato} la lettura non ha dato lo stato: non contano come libere.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
          <ul className="space-y-1">
            {apparati.map((a) => {
              const attivo = a.ip === ip;
              const piene = a.porte.length - a.libere - a.senzaStato;
              return (
                <li key={a.ip}>
                  <button
                    type="button"
                    aria-current={attivo ? "true" : undefined}
                    onClick={() => { setIp(a.ip); setPorta(null); }}
                    className={`w-full rounded-md border px-2.5 py-1.5 text-left hover:border-primary ${attivo ? "border-foreground bg-muted font-semibold" : "border-transparent"}`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[14px]">{a.nome}</span>
                      <span className="shrink-0 font-mono text-[13px] tabular-nums">{a.libere} libere</span>
                    </span>
                    <span className="mt-1 flex h-1.5 overflow-hidden rounded-sm border border-[var(--vc-bordo)]" aria-hidden="true">
                      <span className="bg-[var(--vc-acceso)]" style={{ width: `${a.porte.length ? (piene / a.porte.length) * 100 : 0}%` }} />
                    </span>
                    <span className="text-[13px] font-normal text-muted-foreground">
                      {a.ip} · {piene} collegate su {a.porte.length}{a.senzaStato > 0 ? ` · ${a.senzaStato} senza stato` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {scelto && (
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[15px] font-semibold">{scelto.nome}</p>
                <Link href={`/cliente/apparati?tipo=rete&ip=${encodeURIComponent(scelto.ip)}`} className="text-[13px] font-medium text-cian-testo hover:underline">
                  Apri in Apparati →
                </Link>
              </div>
              <Legenda
                voci={[
                  { classe: "bg-[var(--vc-acceso)]", testo: "collegata" },
                  { classe: "border-[var(--vc-bordo)]", testo: "libera" },
                  ...(scelto.senzaStato > 0 ? [{ classe: "border-dashed border-[var(--vc-bordo)]", testo: "senza stato" }] : []),
                  { classe: "shadow-[0_0_0_2px_var(--vc-cian)]", testo: "dorsale" },
                ]}
              />
              <div className="grid grid-cols-12 gap-1">
                {scelto.porte.map((p) => (
                  <button
                    key={`${p.nome}-${p.numero}`}
                    type="button"
                    title={p.nome}
                    aria-label={`Porta ${p.numero}, ${p.stato === "senza_stato" ? "stato non letto" : p.stato}`}
                    aria-pressed={p.numero === porta}
                    onClick={() => setPorta(p.numero)}
                    className={classePorta(p, p.numero === porta)}
                  >
                    {p.stato === "senza_stato" ? `${p.numero}?` : p.numero}
                  </button>
                ))}
              </div>
              {portaScelta
                ? <DettaglioPorta porta={portaScelta} />
                : <p className="text-[13px] text-muted-foreground">Scegli una porta per vedere chi c&apos;è attaccato.</p>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
