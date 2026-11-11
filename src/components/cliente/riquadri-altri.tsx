import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import { daQuanto } from "@/lib/cliente/testi";
import type { apparatiNuovi, certificati, disponibilita, importantiSpenti, sistemiOperativi } from "@/lib/cliente/altri-dati";
import { GIORNI_DISPONIBILITA, GIORNI_NUOVI, GIORNI_SCADENZA } from "@/lib/cliente/altri-dati";

/**
 * I riquadri della casa nati dal censimento dell'11/11/2026. Colori solo da `--vc-*`; ogni stato
 * ha la sua icona (Riccardo è daltonico: la forma dice lo stato, il colore lo rinforza).
 */

function Numero({ valore, testo }: { valore: string | number; testo: string }) {
  return (
    <p className="text-sm">
      <span className="font-mono text-2xl font-bold tabular-nums">{valore}</span>
      <span className="ml-2 text-muted-foreground">{testo}</span>
    </p>
  );
}

function giorno(raw: string): string {
  const d = parseDbDate(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI, weekday: "short", day: "2-digit", month: "2-digit" });
}

/** Apparati comparsi in rete negli ultimi 7 giorni. */
export function ApparatiNuovi({ dati }: { dati: ReturnType<typeof apparatiNuovi> }) {
  return (
    <div className="space-y-2">
      <Numero valore={dati.totale} testo={`${dati.totale === 1 ? "apparato comparso" : "apparati comparsi"} negli ultimi ${GIORNI_NUOVI} giorni`} />
      <ul>
        {dati.apparati.map((a) => (
          <li key={a.ip} className="flex items-baseline gap-2 border-t py-1.5 text-[13px]">
            <span className="min-w-0 flex-1 truncate" title={a.nome}>
              <span className="font-semibold">{a.nome}</span>
              {a.nome !== a.ip && <span className="ml-2 font-mono text-muted-foreground">{a.ip}</span>}
            </span>
            <span className="shrink-0 text-muted-foreground">{a.cosa ?? "da riconoscere"}</span>
            <span className="w-20 shrink-0 text-right text-muted-foreground">{giorno(a.vistoDal)}</span>
          </li>
        ))}
      </ul>
      {dati.totale > dati.apparati.length && <p className="text-[13px] text-muted-foreground">e altri {dati.totale - dati.apparati.length}</p>}
    </div>
  );
}

/** Apparati tenuti d'occhio che in questo momento non rispondono. */
export function ImportantiSpenti({ dati }: { dati: NonNullable<ReturnType<typeof importantiSpenti>> }) {
  const adesso = new Date();
  if (dati.spenti.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <CircleCheck className="size-10 text-[var(--vc-cian)]" aria-hidden />
        <p className="text-sm font-semibold">Tutti accesi</p>
        <p className="text-[13px] text-muted-foreground">{dati.segnati} apparati tenuti d&apos;occhio</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Numero valore={dati.spenti.length} testo={`${dati.spenti.length === 1 ? "spento" : "spenti"} su ${dati.segnati} tenuti d'occhio`} />
      <ul>
        {dati.spenti.map((a) => (
          <li key={a.ip} className="flex items-center gap-2 border-t py-1.5 text-[13px]">
            <TriangleAlert className="size-4 shrink-0 text-[var(--vc-grave)]" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-semibold" title={`${a.nome} · ${a.ip}`}>{a.nome}</span>
            <span className="shrink-0 text-muted-foreground">{a.vistoIl ? `spento ${daQuanto(parseDbDate(a.vistoIl), adesso)}` : "mai visto acceso"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Quanto sono stati accesi gli apparati tenuti d'occhio: una barra per apparato, i peggiori prima. */
export function Disponibilita({ dati }: { dati: NonNullable<ReturnType<typeof disponibilita>> }) {
  return (
    <div className="space-y-2">
      <Numero valore={`${dati.media.toLocaleString("it-IT")}%`} testo={`in media negli ultimi ${GIORNI_DISPONIBILITA} giorni, su ${dati.apparati.length} apparati tenuti d'occhio`} />
      <div className="space-y-1.5">
        {dati.apparati.map((a) => {
          const basso = a.percento < 99;
          return (
            <div key={a.ip} className="grid grid-cols-[minmax(0,1fr)_minmax(3rem,40%)_4rem] items-center gap-2 text-[13px]">
              <span className="flex min-w-0 items-center gap-1.5" title={`${a.nome} · ${a.ip} · ${a.controlli} controlli`}>
                {basso ? <CircleAlert className="size-4 shrink-0 text-[var(--vc-grave)]" aria-hidden /> : <CircleCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="truncate">{a.nome}</span>
              </span>
              <span className="h-2 overflow-hidden rounded-sm bg-[var(--vc-barra-fondo)]" aria-hidden>
                <span className={`block h-full ${basso ? "bg-[var(--vc-grave)]" : "bg-[var(--vc-cian)]"}`} style={{ width: `${a.percento}%` }} />
              </span>
              <span className="text-right font-mono tabular-nums">{a.percento.toLocaleString("it-IT")}%</span>
            </div>
          );
        })}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 pt-1 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><CircleAlert className="size-3.5 text-[var(--vc-grave)]" aria-hidden /> sotto il 99%</span>
        <span>quota dei controlli in cui l&apos;apparato ha risposto</span>
      </p>
    </div>
  );
}

/** Sistemi operativi delle macchine sotto controllo; segnati quelli che il produttore non aggiorna più. */
export function SistemiOperativi({ dati }: { dati: NonNullable<ReturnType<typeof sistemiOperativi>> }) {
  const max = Math.max(1, ...dati.sistemi.map((s) => s.macchine));
  return (
    <div className="space-y-2">
      <Numero
        valore={dati.fuoriSupporto}
        testo={`${dati.fuoriSupporto === 1 ? "macchina" : "macchine"} su ${dati.macchine} con un sistema non più aggiornato dal produttore`}
      />
      <div className="space-y-1.5">
        {dati.sistemi.map((s) => (
          <div key={s.nome} className="grid grid-cols-[minmax(0,1fr)_minmax(3rem,35%)_2.5rem] items-center gap-2 text-[13px]">
            <span className="flex min-w-0 items-center gap-1.5">
              {s.fuoriSupporto && <TriangleAlert className="size-4 shrink-0 text-[var(--vc-grave)]" aria-label="non più aggiornato" />}
              <span className="truncate" title={s.nome}>{s.nome}</span>
            </span>
            <span className="h-2 overflow-hidden rounded-sm bg-[var(--vc-barra-fondo)]" aria-hidden>
              <span className={`block h-full ${s.fuoriSupporto ? "bg-[var(--vc-grave)]" : "bg-[var(--vc-cian)]"}`} style={{ width: `${(s.macchine / max) * 100}%` }} />
            </span>
            <span className="text-right font-mono tabular-nums">{s.macchine}</span>
          </div>
        ))}
      </div>
      <p className="flex items-center gap-1 pt-1 text-[13px] text-muted-foreground">
        <TriangleAlert className="size-3.5 text-[var(--vc-grave)]" aria-hidden /> non più aggiornato dal produttore
      </p>
    </div>
  );
}

/** Certificati scaduti o in scadenza entro 30 giorni. */
export function Certificati({ dati }: { dati: NonNullable<ReturnType<typeof certificati>> }) {
  if (dati.elenco.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <CircleCheck className="size-10 text-[var(--vc-cian)]" aria-hidden />
        <p className="text-sm font-semibold">Nessun certificato in scadenza</p>
        <p className="text-[13px] text-muted-foreground">{dati.controllati} controllati · nessuno scade entro {GIORNI_SCADENZA} giorni</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Numero
        valore={dati.scaduti + dati.inScadenza}
        testo={`da rinnovare su ${dati.controllati}: ${dati.scaduti} ${dati.scaduti === 1 ? "scaduto" : "scaduti"}, ${dati.inScadenza} entro ${GIORNI_SCADENZA} giorni`}
      />
      <ul>
        {dati.elenco.map((c) => (
          <li key={`${c.dove}-${c.nome}`} className="flex items-center gap-2 border-t py-1.5 text-[13px]">
            {c.scaduto ? <TriangleAlert className="size-4 shrink-0 text-[var(--vc-grave)]" aria-hidden /> : <CircleAlert className="size-4 shrink-0" aria-hidden />}
            <span className="min-w-0 flex-1 truncate" title={`${c.nome} · ${c.dove}`}>
              <span className="font-semibold">{c.nome}</span>
              <span className="ml-2 font-mono text-muted-foreground">{c.dove}</span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              {c.scaduto ? `scaduto da ${Math.abs(c.giorni)} ${Math.abs(c.giorni) === 1 ? "giorno" : "giorni"}` : c.giorni === 0 ? "scade oggi" : `scade fra ${c.giorni} ${c.giorni === 1 ? "giorno" : "giorni"}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
