"use client";

interface Props {
  title: string;
  empty: string;
  rows: Array<{ key: string; count: number }>;
  total?: number;
}

export function DnsTopTable({ title, empty, rows, total }: Props) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1.5">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="rounded border overflow-hidden">
          <table className="w-full text-xs">
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b last:border-0">
                  <td className="px-2 py-1.5 font-mono truncate max-w-[12rem]" title={row.key}>
                    {row.key}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">
                    {row.count.toLocaleString("it-IT")}
                    {total != null && total > 0 && (
                      <span className="text-muted-foreground ml-1">
                        ({Math.round((row.count / total) * 100)}%)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
