"use client";

/**
 * Matrice porte × VLAN condivisa (estratta dalla scheda MikroTik, Task 10; artboard MkVlan e SwitchVlan): nomi VLAN in
 * verticale, id in badge, U pieno scuro e T bordo spesso con la lettera, legenda. Il modello è in `lib/scheda/matrice-vlan.ts`.
 */
import { Fragment, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { CellaVlan, MatriceVlanBase, RigaMatrice } from "@/lib/scheda/matrice-vlan";

/** Stato della porta: segno + parola, come nelle Interfacce. */
export function StatoPorta({ s }: { s: "attiva" | "inattiva" | "disabilitata" }) {
  if (s === "attiva") return <span className="font-semibold">✓ attiva</span>;
  if (s === "disabilitata") return <span className="font-semibold text-[#8E1B20] dark:text-[#E8625A]">✕ disabilitata</span>;
  return <span className="text-muted-foreground">● inattiva</span>;
}

/** U pieno scuro, T bordo spesso su chiaro: si distinguono dalla lettera e dalla luminanza, mai dal solo colore. */
export function Cella({ c }: { c: CellaVlan }) {
  if (c === "U") return <span className="inline-flex h-[26px] w-[30px] items-center justify-center rounded border-2 border-[#0D2537] bg-[#0D2537] text-sm font-bold text-white dark:border-sky-100 dark:bg-sky-100 dark:text-[#0D2537]">U</span>;
  if (c === "T") return <span className="inline-flex h-[26px] w-[30px] items-center justify-center rounded border-[3px] border-[#0D2537] bg-white text-sm font-bold text-[#0D2537] dark:border-sky-100 dark:bg-transparent dark:text-sky-100">T</span>;
  return null;
}

/*
 * Intestazione e prime tre colonne fisse, altezza limitata (giro del 22/10): con 24 VLAN e 50 porte la tabella era alta
 * ~2500 px e la barra orizzontale stava in fondo, fuori vista, così le colonne a destra sembravano tagliate. Le celle
 * fisse hanno un fondo pieno (una trasparenza lascerebbe vedere le righe sotto) e il bordo come ombra interna: con
 * `border-collapse` i bordi delle celle fisse scorrono via. Gli scostamenti (larghezza delle colonne fisse, altezza della
 * prima riga d'intestazione) si misurano: i nomi delle porte cambiano da un apparato all'altro.
 */
const fondoTesta = "bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]";
const thFisso = `sticky top-0 z-30 whitespace-nowrap px-3 py-1.5 text-left align-bottom text-[13px] font-semibold text-muted-foreground ${fondoTesta} shadow-[inset_0_-2px_0_var(--border)]`;
const sinistra = ["left-0", "left-[var(--mv-c1)]", "left-[var(--mv-c2)]"] as const;
const ultimaFissa = "shadow-[inset_-1px_0_0_var(--border)]";

/**
 * Pezzo del corpo della tabella (tab VLAN degli switch, artboard SwitchVlan V4-V5): un titolo di sezione («Porte SFP+»),
 * delle righe, o una riga a tutta larghezza («+6 porte senza VLAN · mostra ›»).
 */
export interface BloccoMatrice { chiave: string; titolo?: ReactNode; righe?: RigaMatrice[]; riga?: ReactNode }

/**
 * `prima` = intestazione della colonna porta; `avviso` = riga in fondo, sotto la legenda (es. matrice parziale);
 * `blocchi` = corpo diviso in sezioni (senza, le righe di `m` nell'ordine dato, come per i MikroTik).
 */
export function TabellaMatriceVlan({ m, prima = "Interfaccia", avviso, blocchi }: { m: MatriceVlanBase; prima?: string; avviso?: ReactNode; blocchi?: BloccoMatrice[] }) {
  const larghezza = 3 + m.colonne.length;
  const tabella = useRef<HTMLTableElement>(null);
  const fisse = useRef<Array<HTMLTableCellElement | null>>([]);
  const primaRiga = useRef<HTMLTableRowElement>(null);
  useLayoutEffect(() => {
    const t = tabella.current;
    if (!t) return;
    const misura = () => {
      const [a, b] = fisse.current.map((c) => c?.getBoundingClientRect().width ?? 0);
      t.style.setProperty("--mv-c1", `${a}px`);
      t.style.setProperty("--mv-c2", `${a + b}px`);
      t.style.setProperty("--mv-h1", `${primaRiga.current?.getBoundingClientRect().height ?? 0}px`);
    };
    misura();
    const o = new ResizeObserver(misura);
    o.observe(t);
    return () => o.disconnect();
  }, [m]);
  const fondoRiga = (r: RigaMatrice) => (r.stato === "attiva" ? "bg-card" : "bg-[color-mix(in_oklab,var(--muted)_30%,var(--card))]");
  const tdFisso = (r: RigaMatrice, k: 0 | 1 | 2) => `sticky z-10 whitespace-nowrap px-3 py-1 ${sinistra[k]} ${fondoRiga(r)} ${k === 2 ? ultimaFissa : ""}`;
  const riga = (r: RigaMatrice) => (
    <tr key={r.porta} className={`border-b ${r.stato === "attiva" ? "" : "bg-muted/30"}`}>
      <td className={tdFisso(r, 0)}>
        <span className="font-mono font-semibold">{r.porta}</span>
        {r.nota && <span className="ml-2 text-muted-foreground">· {r.nota}</span>}
      </td>
      <td className={tdFisso(r, 1)}><StatoPorta s={r.stato} /></td>
      <td className={tdFisso(r, 2)}>
        {r.pvid != null ? <span className="rounded border border-[#B8C4CC] bg-muted px-1.5 font-mono font-semibold">P:{r.pvid}</span> : "—"}
        {r.pvid_nota && <span className="ml-1 whitespace-nowrap text-[13px] font-semibold">▲ {r.pvid_nota}</span>}
      </td>
      {r.celle.map((c, k) => <td key={m.colonne[k].etichetta} className="h-[32px] border-l px-1 text-center"><Cella c={c} /></td>)}
    </tr>
  );
  return (
    <>
      <div className="-mx-4 max-h-[min(70vh,760px)] overflow-auto overscroll-contain" data-matrice-vlan>
        <table ref={tabella} className="text-[13px]" style={{ "--mv-c1": "0px", "--mv-c2": "0px", "--mv-h1": "0px" } as CSSProperties}>
          <thead>
            <tr ref={primaRiga}>
              <th rowSpan={2} ref={(el) => { fisse.current[0] = el; }} className={`${thFisso} ${sinistra[0]}`}>{prima}</th>
              <th rowSpan={2} ref={(el) => { fisse.current[1] = el; }} className={`${thFisso} ${sinistra[1]}`}>Stato</th>
              <th rowSpan={2} className={`${thFisso} ${sinistra[2]} shadow-[inset_-1px_0_0_var(--border),inset_0_-2px_0_var(--border)]`}>PVID</th>
              {m.colonne.map((c) => (
                <th key={c.etichetta} className={`sticky top-0 z-20 border-l px-1 pt-1.5 text-center align-bottom text-[13px] font-semibold ${fondoTesta}`}>
                  {/* Nome in verticale come nel Manager: la colonna resta larga quanto la cella U/T, e 12+ VLAN entrano a 1440. */}
                  <span className="mx-auto block max-h-[8rem] overflow-hidden text-ellipsis whitespace-nowrap [writing-mode:vertical-rl] rotate-180" title={c.nome ?? undefined}>{c.nome ?? "·"}</span>
                </th>
              ))}
            </tr>
            <tr>
              {m.colonne.map((c) => (
                <th key={c.etichetta} className={`sticky top-[var(--mv-h1)] z-20 border-l px-1 pb-1.5 text-center ${fondoTesta} shadow-[inset_0_-2px_0_var(--border)]`}>
                  <span className="inline-block rounded border border-[#B8C4CC] bg-muted px-1.5 font-mono text-[13px] font-semibold">{c.etichetta}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {blocchi
              ? blocchi.map((b) => (
                <Fragment key={b.chiave}>
                  {b.titolo && (
                    <tr className="border-b-2">
                      {/* Il titolo resta a sinistra mentre la tabella scorre: fisso dentro una cella a tutta larghezza. */}
                      <td colSpan={larghezza} className="px-3 pb-1 pt-3 text-[13px] font-bold uppercase tracking-wider text-muted-foreground"><span className="sticky left-3">{b.titolo}</span></td>
                    </tr>
                  )}
                  {b.righe?.map(riga)}
                  {b.riga && (
                    <tr className="border-b bg-muted/20">
                      <td colSpan={larghezza} className="px-3 py-1.5"><span className="sticky left-3 inline-block">{b.riga}</span></td>
                    </tr>
                  )}
                </Fragment>
              ))
              : m.righe.map(riga)}
          </tbody>
        </table>
      </div>
      <p className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Cella c="U" /> untagged</span>
        <span className="inline-flex items-center gap-1.5"><Cella c="T" /> tagged</span>
        <span>✓ attiva · ● inattiva · ✕ disabilitata</span>
        <span>U se la porta è negli untagged della VLAN o il suo PVID è quella VLAN; T se è nei tagged.</span>
      </p>
      {avviso}
    </>
  );
}
