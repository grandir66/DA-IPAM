import { Badge } from "@/components/ui/badge";
import { SOURCE_BADGE_STYLE, nvdCveUrl } from "@/lib/severity-style";

export function CveLink({ cve }: { cve: string | null | undefined }) {
  if (!cve) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={nvdCveUrl(cve)}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline font-mono text-xs"
    >
      {cve}
    </a>
  );
}

export function SourcesBadges({ sources }: { sources: string[] | undefined | null }) {
  if (!sources || sources.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {sources.map((src) => (
        <Badge
          key={src}
          className={`text-[10px] px-1.5 py-0 ${SOURCE_BADGE_STYLE[src] ?? "bg-slate-600 text-white"}`}
        >
          {src}
        </Badge>
      ))}
    </div>
  );
}
