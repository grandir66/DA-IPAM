"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortDirection } from "@/lib/table-sort";

export type { SortDirection };

type SortableTableHeadProps = {
  /** Identificatore colonna (deve coincidere con sortColumn nello stato) */
  columnId: string;
  children: React.ReactNode;
  sortColumn: string | null;
  sortDirection: SortDirection;
  onSort: (columnId: string) => void;
  className?: string;
  title?: string;
};

/**
 * Intestazione tabella cliccabile per ordinamento client o server (stato gestito dal parent).
 */
export function SortableTableHead({
  columnId,
  children,
  sortColumn,
  sortDirection,
  onSort,
  className,
  title,
}: SortableTableHeadProps) {
  const active = sortColumn === columnId;
  return (
    <TableHead
      scope="col"
      title={title}
      className={cn(
        "cursor-pointer select-none hover:bg-muted/60 transition-colors",
        active && "bg-muted/40",
        className
      )}
      onClick={(e) => {
        e.stopPropagation();
        onSort(columnId);
      }}
    >
      <span className="inline-flex items-center gap-1.5">
        {children}
        {!active && <ArrowUpDown className="h-3.5 w-3.5 opacity-40 shrink-0" aria-hidden />}
        {active && sortDirection === "asc" && <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />}
        {active && sortDirection === "desc" && <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      </span>
    </TableHead>
  );
}
