"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface MarkdownViewerProps {
  content: string;
  /** Slug del documento corrente — usato per riscrivere i link relativi tipo `[x](OTHER.md)` */
  currentSlug?: string;
}

/**
 * Renderer markdown per i documenti di /docs. Riscrive i link relativi a .md
 * verso `/manual?doc=<slug>` così la navigazione fra documenti resta in-app
 * senza ricaricare la pagina o uscire dall'app.
 */
export function MarkdownViewer({ content }: MarkdownViewerProps) {
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-headings:scroll-mt-20 prose-headings:font-semibold",
        "prose-h1:text-3xl prose-h1:border-b prose-h1:pb-3 prose-h1:mb-6",
        "prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-h2:border-b prose-h2:pb-2",
        "prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3",
        "prose-h4:text-lg prose-h4:mt-6 prose-h4:mb-2",
        "prose-table:text-sm prose-table:my-4",
        "prose-th:bg-muted prose-th:font-semibold prose-th:px-3 prose-th:py-2 prose-th:text-left",
        "prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-border",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em]",
        "prose-pre:bg-muted prose-pre:border prose-pre:border-border",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        "prose-blockquote:border-l-primary prose-blockquote:bg-muted/40 prose-blockquote:px-4 prose-blockquote:py-1 prose-blockquote:not-italic"
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...props }) {
            if (!href) return <a {...props}>{children}</a>;

            // Link esterno → nuovo tab
            if (/^https?:\/\//i.test(href)) {
              return (
                <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                  {children}
                </a>
              );
            }

            // Link a un altro .md → resta in-app via /manual?doc=
            const mdMatch = href.match(/^\.?\.?\/?(?:docs\/)?([A-Za-z0-9_/-]+)\.md(#.*)?$/);
            if (mdMatch) {
              const path = mdMatch[1];
              const hash = mdMatch[2] ?? "";
              const slug = path.toLowerCase().replace(/\//g, "__");
              return (
                <Link href={`/manual?doc=${slug}${hash}`} {...props}>
                  {children}
                </Link>
              );
            }

            // Link a path relativo non-md (es. src/lib/...) → apre raw in nuovo tab
            // così l'utente capisce che è un file di codice
            if (href.startsWith("../") || href.startsWith("./")) {
              return (
                <a href={`#`} title={`Riferimento codice: ${href}`} className="cursor-help">
                  {children}
                </a>
              );
            }

            // Anchor interno (#section) o assoluto interno
            return (
              <a href={href} {...props}>
                {children}
              </a>
            );
          },
          // Aggiunge ID ai headings (h2/h3) per ancore funzionanti
          h2({ children, ...props }) {
            const text = String(children);
            const id = slugifyHeading(text);
            return <h2 id={id} {...props}>{children}</h2>;
          },
          h3({ children, ...props }) {
            const text = String(children);
            const id = slugifyHeading(text);
            return <h3 id={id} {...props}>{children}</h3>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
