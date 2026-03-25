"use client";

import { useCallback, useMemo, useState } from "react";
import { compareUnknown, type SortDirection } from "@/lib/table-sort";

/**
 * Ordinamento lato client su un array: toggle colonna e direzione.
 */
export function useClientTableSort<T>(
  rows: T[],
  accessors: Record<string, (row: T) => unknown>,
  defaultColumn: string | null = null,
  defaultDir: SortDirection = "asc"
) {
  const [sortColumn, setSortColumn] = useState<string | null>(defaultColumn);
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultDir);

  const onSort = useCallback(
    (columnId: string) => {
      if (sortColumn === columnId) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortColumn(columnId);
        setSortDirection("asc");
      }
    },
    [sortColumn]
  );

  const sortedRows = useMemo(() => {
    if (!sortColumn || !accessors[sortColumn]) return rows;
    const get = accessors[sortColumn];
    return [...rows].sort((a, b) => compareUnknown(get(a), get(b), sortDirection));
  }, [rows, sortColumn, sortDirection, accessors]);

  return {
    sortedRows,
    sortColumn,
    sortDirection,
    onSort,
    setSortColumn,
    setSortDirection,
  };
}
