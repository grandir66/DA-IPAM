"use client";

/**
 * Pezzi di base condivisi dai componenti della scheda apparato (spostati da `objects/[id]/page.tsx`, 21/10):
 * date del DB, `InfoRow`/`Section` del contenuto di «Dettagli», e `Campo` (etichetta a 13 px) per i componenti nuovi.
 */
import { parseDbDate } from "@/lib/db-date";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Parser sicuro per stringhe datetime SQLite/ISO.
 * SQLite `datetime('now')` ritorna "YYYY-MM-DD HH:MM:SS" senza timezone marker:
 * il browser lo interpreterebbe come LOCAL invece di UTC → orari shiftati.
 * Forziamo UTC se manca un marker esplicito.
 */
export function parseUtcDate(s: string): Date {
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return parseDbDate(s);
  return parseDbDate(s.replace(" ", "T") + "Z");
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return parseUtcDate(iso).toLocaleString("it-IT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatGb(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1024) return `${(n / 1024).toFixed(1)} TB`;
  return `${Math.round(n)} GB`;
}

export interface InfoRowProps {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

export function InfoRow({ label, value, mono }: InfoRowProps) {
  const empty = value == null || value === "" || value === "—";
  return (
    <div className="min-w-0">
      <dt className="text-[13px] uppercase tracking-wider text-muted-foreground font-medium">{label}</dt>
      <dd className={`text-sm mt-0.5 ${mono ? "font-mono" : ""} ${empty ? "text-muted-foreground/50" : ""}`}>
        {empty ? "—" : value}
      </dd>
    </div>
  );
}

export interface SectionProps {
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  /** id opzionale per ancore di scroll (es. dal badge header) */
  id?: string;
}

export function Section({ icon, title, badge, children, id }: SectionProps) {
  return (
    <Card className="overflow-hidden" id={id}>
      <CardHeader className="bg-muted/30 border-b py-2.5 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <span>{title}</span>
          {badge}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

/** Coppia etichetta/valore dei componenti nuovi: etichetta a 13 px, valore vuoto = non si rende (niente «—»). */
export function Campo({ label, value, mono, children }: { label: string; value?: ReactNode; mono?: boolean; children?: ReactNode }) {
  const contenuto = children ?? value;
  if (contenuto == null || contenuto === "") return null;
  return (
    <div className="min-w-0">
      <dt className="text-[13px] font-semibold text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm ${mono ? "font-mono" : ""}`}>{contenuto}</dd>
    </div>
  );
}
