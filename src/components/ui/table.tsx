"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useAltezzaDisponibile } from "@/hooks/use-altezza-disponibile"

/** Intestazioni ferme: sfondo pieno (si scorre sotto) e riga di separazione disegnata,
 *  perché il bordo del <tr> non segue la cella appiccicata. */
const INTESTAZIONI_FERME =
  // Solo la tabella diretta: le sottotabelle delle righe espanse (Software, Vulnerabilità)
  // non devono incollarsi in cima sopra le intestazioni principali.
  // Anche `td` nel thead: alcune pagine (Anomalie) scrivono l'intestazione con TableCell.
  "[&>table>thead_:is(th,td)]:sticky [&>table>thead_:is(th,td)]:top-0 [&>table>thead_:is(th,td)]:z-10 [&>table>thead_:is(th,td)]:bg-card [&>table>thead_:is(th,td)]:shadow-[inset_0_-1px_0_var(--border)]"

/**
 * Contenitore che scorre per una tabella con le intestazioni ferme (20/10, Riccardo;
 * regola del kit di DA-Template): alto quanto lo spazio che resta sullo schermo, così
 * scorre la tabella e non la pagina, e titolo, filtri e paginazione restano dove sono.
 * Si usa da solo attorno a una <table> scritta a mano, o con <Table fissa>.
 * `riserva`: spazio da lasciare sotto la tabella (paginazione, margini).
 */
function ScorrimentoTabella({
  className,
  riserva,
  children,
  ...props
}: React.ComponentProps<"div"> & { riserva?: number }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const altezza = useAltezzaDisponibile(ref, true, riserva)
  return (
    <div
      ref={ref}
      data-slot="table-container"
      data-fissa=""
      className={cn("relative w-full overflow-auto", INTESTAZIONI_FERME, className)}
      style={altezza ? { maxHeight: altezza } : undefined}
      {...props}
    >
      {children}
    </div>
  )
}

/** `fissa`: dentro uno ScorrimentoTabella (intestazioni ferme, scorre la tabella). */
function Table({
  className,
  fissa = false,
  riserva,
  ...props
}: React.ComponentProps<"table"> & { fissa?: boolean; riserva?: number }) {
  const tabella = (
    <table
      data-slot="table"
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  )
  if (fissa) return <ScorrimentoTabella riserva={riserva}>{tabella}</ScorrimentoTabella>
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      {tabella}
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  ScorrimentoTabella,
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
