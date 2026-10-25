import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Mattoni delle pagine «console» (docs/STILE-UI.md). Vengono dal modello HTML di Riccardo
 * del 24/10 (console del sensore trunk), portato sui colori Domarc: barra di stato in cima,
 * tessere coi numeri, pannelli numerati che si filtrano l'uno con l'altro, voci da
 * scegliere, legenda, scheda di dettaglio. Una pagina nuova si compone con questi pezzi
 * invece di ridisegnarli: è la ragione per cui esistono.
 */

/** Titolo della pagina: uno solo, sempre uguale. Spiegazione in una riga, azioni a destra. */
export function IntestazionePagina({
  titolo,
  sottotitolo,
  azioni,
}: {
  titolo: string;
  sottotitolo?: string;
  azioni?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{titolo}</h1>
        {sottotitolo && <p className="mt-1 text-sm text-muted-foreground">{sottotitolo}</p>}
      </div>
      {azioni && <div className="flex flex-wrap items-center gap-2">{azioni}</div>}
    </div>
  );
}

/** Striscia in cima alla pagina: com'è il servizio da cui vengono i dati, in una riga. */
export function BarraStato({
  acceso,
  titolo,
  dettagli = [],
  azioni,
}: {
  acceso: boolean;
  titolo: string;
  /** Fatti brevi in monospazio (interfaccia, ultima lettura, modo): uno per voce. */
  dettagli?: string[];
  azioni?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-2 font-semibold">
          {/* Doppio segnale: pallino pieno o vuoto, non solo il colore (Riccardo è daltonico). */}
          <span
            aria-hidden
            className={cn(
              "inline-block h-2.5 w-2.5 rounded-full border-2",
              acceso ? "border-primary bg-primary" : "border-muted-foreground bg-transparent",
            )}
          />
          {titolo}
          <span className="text-muted-foreground font-normal">{acceso ? "acceso" : "spento"}</span>
        </span>
        {dettagli.map((d) => (
          <span key={d} className="rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-[13px] text-muted-foreground">
            {d}
          </span>
        ))}
      </div>
      {azioni && <div className="flex flex-wrap items-center gap-2">{azioni}</div>}
    </div>
  );
}

/** Tessera di un numero: etichetta, valore grande, qualifica accanto, una riga di fonte. */
export function TesseraNumero({
  titolo,
  valore,
  qualifica,
  nota,
  icona,
}: {
  titolo: string;
  /** `null` = non lo sappiamo: si scrive «—», mai 0. */
  valore: number | string | null;
  /** Due o tre parole accanto al numero: «5 con tag + nativa», «12 già in DA-IPAM». */
  qualifica?: string;
  /** Da dove viene il numero, una riga sola. */
  nota?: string;
  icona?: ReactNode;
}) {
  const testo = valore == null ? "—" : typeof valore === "number" ? valore.toLocaleString("it-IT") : valore;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3.5">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium uppercase tracking-wide text-muted-foreground">{titolo}</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className={cn("font-mono text-2xl font-bold tabular-nums", valore == null && "text-muted-foreground")}>{testo}</span>
          {qualifica && <span className="truncate text-[13px] text-cian-testo">{qualifica}</span>}
        </div>
        {nota && <p className="mt-1 truncate text-[13px] text-muted-foreground">{nota}</p>}
      </div>
      {icona && (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-cian-testo [&_svg]:size-6">
          {icona}
        </div>
      )}
    </div>
  );
}

/**
 * Pannello con intestazione: numero del livello (1. VLAN → 2. Subnet → 3. Oggetti), titolo,
 * conteggio, una riga di spiegazione e le azioni a destra. Il piede è per un consiglio breve.
 */
export function Pannello({
  numero,
  titolo,
  conteggio,
  sottotitolo,
  azioni,
  piede,
  className,
  corpoClassName,
  children,
}: {
  numero?: number;
  titolo: string;
  conteggio?: number | string;
  /** Una riga sola. Un paragrafo di spiegazione va nel `title` o nel manuale. */
  sottotitolo?: string;
  azioni?: ReactNode;
  piede?: ReactNode;
  className?: string;
  corpoClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-cian-testo">
              {numero != null && `${numero}. `}
              {titolo}
            </h2>
            {conteggio != null && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[13px] text-muted-foreground">{conteggio}</span>
            )}
          </div>
          {sottotitolo && <p className="mt-0.5 text-[13px] text-muted-foreground">{sottotitolo}</p>}
        </div>
        {azioni && <div className="flex flex-wrap items-center gap-2">{azioni}</div>}
      </header>
      <div className={cn("min-h-0 flex-1", corpoClassName ?? "p-3")}>{children}</div>
      {piede && <footer className="border-t bg-muted/40 px-3.5 py-2.5 text-[13px] text-muted-foreground">{piede}</footer>}
    </section>
  );
}

/** Voce che si sceglie con un clic (una VLAN, una subnet). Scelta = bordo ciano e fondo tenue. */
export function VoceSelezionabile({
  scelta,
  onScegli,
  className,
  children,
}: {
  scelta: boolean;
  onScegli: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={scelta}
      onClick={onScegli}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onScegli();
        }
      }}
      className={cn(
        "cursor-pointer rounded-xl border p-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        scelta ? "border-primary bg-selezione" : "bg-card hover:border-foreground/25 hover:bg-muted/40",
        className,
      )}
    >
      {children}
    </div>
  );
}

const TONI_ETICHETTA = {
  neutro: "border-border bg-muted text-foreground",
  marca: "border-primary/40 bg-primary/10 text-cian-testo",
  /** Ruolo di un oggetto (GW, DHCP): fondo giallo pieno e testo navy, mai il giallo come testo. */
  ruolo: "border-[#C9A800] bg-[#FFD400] text-[#0D2537]",
} as const;

/** Etichetta rettangolare per identificativi tecnici: «VLAN 20», «GW», «eth1». */
export function Etichetta({
  tono = "neutro",
  mono = true,
  className,
  children,
}: {
  tono?: keyof typeof TONI_ETICHETTA;
  mono?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[13px] leading-none font-semibold whitespace-nowrap",
        mono && "font-mono",
        TONI_ETICHETTA[tono],
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface VoceLegenda {
  /** Classi del quadratino: le stesse della cella o del segmento che spiega. */
  classe: string;
  testo: string;
}

/** Legenda: obbligatoria accanto a ogni mappa, griglia o barra a colori. */
export function Legenda({ voci, className }: { voci: VoceLegenda[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground", className)}>
      {voci.map((v) => (
        <span key={v.testo} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("inline-block h-3 w-3 rounded-sm border border-foreground/15", v.classe)} />
          {v.testo}
        </span>
      ))}
    </div>
  );
}

/** Barra divisa in parti (ascolto / giro ARP, online / offline), coi numeri scritti sopra. */
export function BarraDivisa({ parti }: { parti: Array<{ nome: string; valore: number; classe: string }> }) {
  const totale = parti.reduce((a, p) => a + p.valore, 0);
  return (
    <div>
      <div className="mb-1 flex flex-wrap justify-between gap-x-3 text-[13px] text-muted-foreground">
        {parti.map((p) => (
          <span key={p.nome}>
            {p.nome}: <strong className="font-mono text-foreground">{p.valore}</strong>
          </span>
        ))}
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {totale > 0 &&
          parti.map((p) => (
            <div key={p.nome} className={cn("h-full", p.classe)} style={{ width: `${(p.valore / totale) * 100}%` }} />
          ))}
      </div>
    </div>
  );
}

/** Scheda di dettaglio della voce scelta (un IP della mappa, una riga): etichetta, titolo, dati. */
export function SchedaDettaglio({
  etichetta,
  titolo,
  vuoto,
  azioni,
  children,
}: {
  etichetta: string;
  /** `null` = niente di scelto: si mostra `vuoto`. */
  titolo: string | null;
  vuoto: string;
  azioni?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 rounded-xl border bg-card p-4">
      <div>
        <p className="font-mono text-[13px] uppercase tracking-wider text-cian-testo">{etichetta}</p>
        <h3 className="mt-1 font-mono text-lg font-bold">{titolo ?? "Nessuna scelta"}</h3>
        {titolo == null ? (
          <p className="mt-1 text-[13px] text-muted-foreground">{vuoto}</p>
        ) : (
          <dl className="mt-3 space-y-2.5 border-t pt-3 text-sm">{children}</dl>
        )}
      </div>
      {azioni && <div className="flex flex-col gap-2 border-t pt-3">{azioni}</div>}
    </div>
  );
}

/** Un dato della scheda di dettaglio: nome sopra, valore sotto. */
export function DatoDettaglio({ nome, valore, mono }: { nome: string; valore: ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[13px] text-muted-foreground">{nome}</dt>
      <dd className={cn("font-medium", mono && "font-mono")}>{valore ?? "—"}</dd>
    </div>
  );
}

/** Stato vuoto: cosa manca e cosa fare, non solo «nessun dato». */
export function Vuoto({ titolo, testo, azione }: { titolo: string; testo?: string; azione?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center">
      <p className="font-medium">{titolo}</p>
      {testo && <p className="max-w-md text-[13px] text-muted-foreground">{testo}</p>}
      {azione && <div className="mt-1">{azione}</div>}
    </div>
  );
}

/** Operazione in corso (giro ARP, scansione): riquadro con bordo giallo e avanzamento. */
export function InCorso({ titolo, percentuale, dettaglio }: { titolo: string; percentuale?: number; dettaglio?: string }) {
  return (
    <div className="rounded-lg border border-[#C9A800] bg-card p-3" role="status">
      <div className="mb-1.5 flex items-center justify-between text-[13px]">
        <span className="flex items-center gap-2 font-semibold">
          <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#FFD400] ring-1 ring-[#C9A800]" />
          {titolo}
        </span>
        {percentuale != null && <span className="font-mono font-bold">{Math.round(percentuale)}%</span>}
      </div>
      {percentuale != null && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-[#FFD400] transition-all" style={{ width: `${Math.min(100, Math.max(0, percentuale))}%` }} />
        </div>
      )}
      {dettaglio && <p className="mt-1.5 font-mono text-[13px] text-muted-foreground">{dettaglio}</p>}
    </div>
  );
}
