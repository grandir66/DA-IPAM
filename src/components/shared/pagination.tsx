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
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = [15, 50, 100, 500],
  total,
}: PaginationProps) {
  const showSizeSelector = onPageSizeChange != null && pageSize != null;
  // Backward compat: senza selettore e con una sola pagina non renderizziamo nulla.
  if (totalPages <= 1 && !showSizeSelector) return null;

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
