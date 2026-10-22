"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Se valorizzato insieme a onPageSizeChange, mostra il selettore righe-per-pagina. */
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  /** Totale elementi, mostrato accanto al selettore (es. "di 342"). */
  total?: number;
  /**
   * Nella riga del titolo (Riccardo, 20/10): compatta, senza fasce di margine, così la
   * tabella arriva fino in fondo allo schermo invece di lasciare ~100 px a una riga di
   * paginazione sotto la scheda.
   */
  inTesta?: boolean;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = [15, 50, 100, 500],
  total,
  inTesta = false,
}: PaginationProps) {
  const showSizeSelector = onPageSizeChange != null && pageSize != null;
  // Backward compat: senza selettore e con una sola pagina non renderizziamo nulla.
  if (totalPages <= 1 && !showSizeSelector) return null;
  if (inTesta) {
    return (
      <PaginazioneInTesta
        page={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
        pageSize={pageSize}
        onPageSizeChange={onPageSizeChange}
        pageSizeOptions={pageSizeOptions}
        total={total}
      />
    );
  }

  return (
    <div className="flex items-center justify-center gap-2 pt-4">
      {showSizeSelector && (
        <div className="flex items-center gap-2 mr-auto text-sm text-muted-foreground">
          <span>Righe per pagina:</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={pageSize}
            onChange={(e) => onPageSizeChange!(Number(e.target.value))}
            aria-label="Righe per pagina"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          {total != null && <span className="hidden sm:inline">di {total}</span>}
        </div>
      )}
      {totalPages > 1 && (
        <>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(1)}
            disabled={page <= 1}
            aria-label="Prima pagina"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Pagina precedente"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground px-2">
            Pagina {page} di {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Pagina successiva"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(totalPages)}
            disabled={page >= totalPages}
            aria-label="Ultima pagina"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}

/** Forma compatta per la riga del titolo: «[50] 1–50 di 348 « ‹ 1/7 › »». */
function PaginazioneInTesta({
  page,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions,
  total,
}: Required<Pick<PaginationProps, "page" | "totalPages" | "onPageChange" | "pageSizeOptions">> &
  Pick<PaginationProps, "pageSize" | "onPageSizeChange" | "total">) {
  const da = pageSize != null && total != null ? Math.min(total, (page - 1) * pageSize + 1) : null;
  const a = pageSize != null && total != null ? Math.min(total, page * pageSize) : null;
  return (
    <div className="inline-flex items-center gap-1 text-[13px] text-muted-foreground" role="navigation" aria-label="Pagine">
      {pageSize != null && onPageSizeChange && (
        <select
          className="h-7 rounded-md border border-input bg-background px-1.5 text-[13px]"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          aria-label="Righe per pagina"
          title="Righe per pagina"
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      )}
      {da != null && a != null && <span className="px-1 tabular-nums whitespace-nowrap">{total === 0 ? "0" : `${da}–${a}`} di {total}</span>}
      {totalPages > 1 && (
        <>
          <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(1)} disabled={page <= 1} aria-label="Prima pagina">
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Pagina precedente">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="tabular-nums whitespace-nowrap" title={`Pagina ${page} di ${totalPages}`}>{page}/{totalPages}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} aria-label="Pagina successiva">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} aria-label="Ultima pagina">
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}
