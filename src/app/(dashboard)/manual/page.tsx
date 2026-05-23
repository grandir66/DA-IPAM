import { readFile, readdir } from "fs/promises";
import { join, resolve, sep } from "path";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownViewer } from "@/components/manual/markdown-viewer";
import { cn } from "@/lib/utils";
import { BookOpen, FileText, FileCode, FolderOpen } from "lucide-react";

/** Cartelle dentro docs/ accettate. Tutto il resto è ignorato (sicurezza). */
const ALLOWED_DIRS = ["", "adr", "playbooks"] as const;

/** Documento di default mostrato all'accesso a /manual senza ?doc=. */
const DEFAULT_DOC = "manuale-utente";

interface DocEntry {
  slug: string;          // es. "manuale-utente" o "playbooks__dr"
  filePath: string;      // path assoluto sul filesystem
  category: "Manuali" | "Architettura (ADR)" | "Playbook";
  title: string;         // primo H1 del file, o filename pulito
  filename: string;      // basename per UI
}

/** Trova tutti i .md ammessi in docs/ e sottocartelle whitelisted, restituendo
 *  metadati utili al sidebar di navigazione. */
async function listDocs(): Promise<DocEntry[]> {
  const docsRoot = resolve(process.cwd(), "docs");
  const entries: DocEntry[] = [];

  for (const dir of ALLOWED_DIRS) {
    const dirPath = dir ? join(docsRoot, dir) : docsRoot;
    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.toLowerCase().endsWith(".md")) continue;
      if (f.toUpperCase() === "README.md" && !dir) continue; // README di docs/ non utile
      const filePath = join(dirPath, f);
      const base = f.replace(/\.md$/i, "");
      const slug = (dir ? `${dir}__${base}` : base).toLowerCase();
      const category: DocEntry["category"] =
        dir === "adr" ? "Architettura (ADR)" :
        dir === "playbooks" ? "Playbook" :
        "Manuali";

      // Estrae il primo H1 come titolo
      let title = base.replace(/[-_]/g, " ");
      try {
        const content = await readFile(filePath, "utf-8");
        const h1 = content.match(/^#\s+(.+)$/m);
        if (h1) title = h1[1].trim();
      } catch { /* ignore */ }

      entries.push({ slug, filePath, category, title, filename: f });
    }
  }

  // Ordine: Manuali (in ordine specifico), ADR (per numero), Playbook (alfabetico)
  const manualPriority: Record<string, number> = {
    "manuale-utente": 1,
    "stati-host-e-discovery": 2,
    "manuale-sviluppatore": 3,
  };
  return entries.sort((a, b) => {
    const catOrder = (c: DocEntry["category"]) =>
      c === "Manuali" ? 0 : c === "Architettura (ADR)" ? 1 : 2;
    const co = catOrder(a.category) - catOrder(b.category);
    if (co !== 0) return co;
    if (a.category === "Manuali") {
      return (manualPriority[a.slug] ?? 99) - (manualPriority[b.slug] ?? 99);
    }
    return a.title.localeCompare(b.title, "it");
  });
}

/** Sicuro: traduce uno slug (es. "playbooks__dr") in un path verificato dentro docs/.
 *  Ritorna null se lo slug tenta traversal o referenzia file non in whitelist. */
async function resolveSlugToContent(slug: string): Promise<{ content: string; entry: DocEntry } | null> {
  const entries = await listDocs();
  const entry = entries.find((e) => e.slug === slug);
  if (!entry) return null;

  // Defense in depth: ricontrolla che il filePath risolto sia dentro docs/
  const docsRoot = resolve(process.cwd(), "docs") + sep;
  const resolved = resolve(entry.filePath);
  if (!resolved.startsWith(docsRoot)) return null;

  try {
    const content = await readFile(resolved, "utf-8");
    return { content, entry };
  } catch {
    return null;
  }
}

export default async function ManualPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const sp = await searchParams;
  const slug = (sp.doc ?? DEFAULT_DOC).toLowerCase();

  // Redirect dolce al default se senza param
  if (!sp.doc) redirect(`/manual?doc=${DEFAULT_DOC}`);

  const entries = await listDocs();
  const data = await resolveSlugToContent(slug);
  if (!data) notFound();

  // Raggruppa entries per categoria per il sidebar
  const grouped = entries.reduce<Record<string, DocEntry[]>>((acc, e) => {
    (acc[e.category] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="flex gap-6 min-h-[calc(100vh-4rem)]">
      {/* Sidebar nav documenti */}
      <aside className="w-64 shrink-0 hidden lg:block">
        <Card className="sticky top-4">
          <CardContent className="p-3 space-y-4">
            <div className="flex items-center gap-2 px-2 pb-2 border-b">
              <BookOpen className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Documentazione</h2>
            </div>
            {(["Manuali", "Architettura (ADR)", "Playbook"] as const).map((cat) => {
              const items = grouped[cat] ?? [];
              if (items.length === 0) return null;
              const Icon = cat === "Manuali" ? FileText : cat === "Architettura (ADR)" ? FileCode : FolderOpen;
              return (
                <div key={cat}>
                  <div className="flex items-center gap-1.5 px-2 mb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <Icon className="h-3 w-3" />
                    {cat}
                  </div>
                  <ul className="space-y-0.5">
                    {items.map((e) => (
                      <li key={e.slug}>
                        <Link
                          href={`/manual?doc=${e.slug}`}
                          className={cn(
                            "block px-2 py-1.5 rounded text-xs leading-tight hover:bg-muted",
                            e.slug === slug
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-foreground/80"
                          )}
                        >
                          {e.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </aside>

      {/* Content area */}
      <main className="flex-1 min-w-0">
        <Card>
          <CardContent className="p-6 lg:p-8">
            <div className="mb-4 pb-3 border-b text-xs text-muted-foreground flex items-center justify-between flex-wrap gap-2">
              <span className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                <span className="font-mono">{data.entry.category} / {data.entry.filename}</span>
              </span>
              <a
                href={`https://github.com/grandir66/DA-IPAM/blob/main/docs/${data.entry.filename}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
              >
                Vedi su GitHub ↗
              </a>
            </div>
            <MarkdownViewer content={data.content} currentSlug={slug} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
