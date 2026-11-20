"use client";

/**
 * Il DNS di Active Directory accanto a un host o a un apparato (Riccardo, 18/11/2026): com'è messo
 * (c'è, manca, è diverso) e, per l'amministratore dove le correzioni sono accese, il pulsante che
 * apre l'anteprima. Qui non si scrive mai sul DC: si scrive solo dalla conferma dell'anteprima.
 * Lo stato viene dall'archivio dell'ultima lettura del DNS, non dal DC.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Globe, Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEAdmin } from "@/hooks/use-e-admin";
import { ConfermaCorrezioni, type Anteprima } from "@/app/(dashboard)/active-directory/correzioni-dns";
import type { DnsDiHost as DatiDns, StatoDnsHost } from "@/lib/ad/dns/per-host";

/** Segno e parola: i tre stati si distinguono per forma, non per colore. */
export const SEGNO_DNS: Record<StatoDnsHost, { segno: string; testo: string }> = {
  ok: { segno: "✓", testo: "Nel DNS c'è, nome e reverse a posto" },
  manca: { segno: "∅", testo: "DA-IPAM lo conosce per nome, nel DNS manca" },
  diverso: { segno: "≠", testo: "Nel DNS c'è qualcosa che non torna" },
};

export function SegnoDns({ stato }: { stato: StatoDnsHost | undefined }) {
  if (!stato) return <span className="text-muted-foreground" title="Nel DNS di Active Directory non c'è niente su questo indirizzo">—</span>;
  return (
    <span title={SEGNO_DNS[stato].testo} aria-label={SEGNO_DNS[stato].testo} className={stato === "ok" ? "font-semibold text-muted-foreground" : "inline-flex h-5 min-w-5 items-center justify-center rounded border border-foreground/40 px-1 text-sm font-bold"}>
      {SEGNO_DNS[stato].segno}
    </span>
  );
}

/** Chiede l'anteprima di una richiesta legata a un host (`host:allinea:…`, `host:togli:…`). */
export async function anteprimaDnsHost(integrazione: number, id: string): Promise<Anteprima | null> {
  try {
    const r = await fetch(`/api/ad/${integrazione}/dns/correzioni`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
    const dati = (await r.json()) as Anteprima & { error?: string };
    if (r.ok) return dati;
    toast.error(dati.error ?? "Anteprima non disponibile");
  } catch {
    toast.error("Errore di rete");
  }
  return null;
}

/**
 * Riquadro «DNS» della scheda. `fonte` è la rotta che dà lo stato (`/api/hosts/<id>/dns` o
 * `/api/devices/<id>/dns`); `giro` cambia quando la scheda salva qualcosa, per rileggere.
 * Non mostra niente se nessun DNS di Active Directory sa qualcosa di questo indirizzo.
 */
export function DnsDiHost({ fonte, giro = 0 }: { fonte: string; giro?: number }) {
  const amministratore = useEAdmin();
  const [dns, setDns] = useState<DatiDns[]>([]);
  const [ip, setIp] = useState("");
  const [letto, setLetto] = useState(false);
  const [anteprima, setAnteprima] = useState<{ integrazione: number; dati: Anteprima } | null>(null);
  const [preparo, setPreparo] = useState(false);
  const [riletture, setRiletture] = useState(0);

  const carica = useCallback(async () => {
    try {
      const r = await fetch(fonte, { cache: "no-store" });
      const dati = r.ok ? ((await r.json()) as { ip?: string; letto?: boolean; dns: DatiDns[] }) : { dns: [] as DatiDns[] };
      setIp(dati.ip ?? "");
      setLetto(dati.letto === true);
      setDns(dati.dns);
    } catch {
      setDns([]); // il DNS è un di più: se non risponde la scheda resta com'è
    }
  }, [fonte]);
  useEffect(() => { void carica(); }, [carica, giro, riletture]);

  // Il DNS è stato letto ma di questo indirizzo non sa niente: si dice, altrimenti sembra che il riquadro manchi (Riccardo, 20/11/2026).
  if (dns.length === 0) {
    if (!letto) return null;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm">
        <span className="flex items-center gap-2 font-semibold"><Globe className="h-4 w-4" />DNS di Active Directory</span>
        <span className="text-muted-foreground">nessun nome e nessun reverse per {ip || "questo indirizzo"}</span>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {dns.map((d) => (
        <div key={d.integrazione} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm">
          <span className="flex items-center gap-2 font-semibold">
            <Globe className="h-4 w-4" />
            DNS di {d.dominio}
            {d.stato && <SegnoDns stato={d.stato} />}
          </span>
          <span>{d.stato ? SEGNO_DNS[d.stato].testo : ""}</span>
          {d.nomi.length > 0 && <span className="font-mono text-[13px]">{d.nomi.join(", ")}</span>}
          {d.reverse.length > 0 && <span className="text-[13px] text-muted-foreground">reverse: <span className="font-mono">{d.reverse.join(", ")}</span></span>}
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground">{d.lettoIl ? `letto il ${d.lettoIl.slice(0, 16)} UTC` : "mai letto"}</span>
            {amministratore && d.correzioniAccese && d.allinea && (
              <Button
                size="sm"
                disabled={preparo}
                onClick={async () => {
                  setPreparo(true);
                  const dati = await anteprimaDnsHost(d.integrazione, d.allinea!);
                  setPreparo(false);
                  if (dati) setAnteprima({ integrazione: d.integrazione, dati });
                }}
              >
                {preparo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wrench className="mr-1.5 h-4 w-4" />}
                Aggiorna il DNS…
              </Button>
            )}
            {(d.stato !== "ok" || d.anomalie.length > 0) && <Link href={`/active-directory?tab=dns&cerca=${encodeURIComponent(ip)}`} className="text-[13px] underline">Apri la scheda DNS</Link>}
          </span>
          {/* Cosa non torna, per esteso: senza questo il segno diceva «qualcosa non va» e basta (Riccardo, 20/11/2026). */}
          {(d.nota || d.anomalie.length > 0) && (
            <ul className="basis-full space-y-0.5 text-[13px]">
              {d.nota && <li>{d.nota}</li>}
              {d.anomalie.map((a, n) => <li key={n}><span className="font-semibold">{a.etichetta}</span>: {a.dettaglio}</li>)}
            </ul>
          )}
        </div>
      ))}
      <ConfermaCorrezioni
        integrationId={anteprima?.integrazione ?? 0}
        anteprima={anteprima?.dati ?? null}
        onChiudi={(fatto) => { setAnteprima(null); if (fatto) setRiletture((n) => n + 1); }}
      />
    </div>
  );
}
