/**
 * GET /api/rilievi — elenco unico Findings (CVE + trunk + giri).
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { FONTI_RILIEVO, type FonteRilievo } from "@/lib/rilievi/tipi";
import { elencoRilievi, ORDINI_RILIEVI, type OrdineRilievi } from "@/lib/rilievi/unione";
import { OS_FAMILIES, type OsFamily } from "@/lib/db-tenant";
import { RAGGRUPPAMENTI, type Raggruppamento } from "@/lib/rilievi/gruppi";
import { STATI_TRIAGE, type StatoTriage } from "@/lib/triage/db";
import { SEVERITIES, type Severity } from "@/lib/severity-style";
import { exploitPerRotte } from "@/lib/vuln/exploit-feed/archivio";
import { cvssPerRotte } from "@/lib/rilievi/barre-di-serie";

export async function GET(request: Request) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;
  return withTenantFromSession(() => {
    const q = new URL(request.url).searchParams;
    const fonti = q.get("fonte")
      ?.split(",")
      .map((s) => s.trim())
      .filter((s): s is FonteRilievo => (FONTI_RILIEVO as readonly string[]).includes(s));
    const gravita = q.get("gravita")
      ?.split(",")
      .map((s) => s.trim())
      .filter((s): s is Severity => (SEVERITIES as readonly string[]).includes(s));
    const page = Number(q.get("page") ?? 1);
    const pageSize = Number(q.get("pageSize") ?? 50);
    const host = Number(q.get("host_id"));
    const per = q.get("raggruppa");
    const raggruppa = (RAGGRUPPAMENTI as readonly string[]).includes(per ?? "") ? (per as Raggruppamento) : undefined;
    const exploit = q.get("exploit")?.split(",").filter((s): s is "kev" | "edb" => s === "kev" || s === "edb");
    const stato = q.get("stato")?.split(",").filter((s): s is StatoTriage => (STATI_TRIAGE as readonly string[]).includes(s));
    const os = q.get("os")?.split(",").filter((s): s is OsFamily => (OS_FAMILIES as readonly string[]).includes(s));
    const ordina = (ORDINI_RILIEVI as readonly string[]).includes(q.get("ordina") ?? "") ? (q.get("ordina") as OrdineRilievi) : undefined;
    const verso = q.get("verso") === "asc" ? ("asc" as const) : q.get("verso") === "desc" ? ("desc" as const) : undefined;
    const intero = (nome: string): number | undefined => {
      const v = Number(q.get(nome));
      return q.get(nome) && Number.isInteger(v) && v > 0 ? v : undefined;
    };
    return NextResponse.json(
      elencoRilievi({
        fonti,
        gravita,
        q: q.get("q") ?? undefined,
        ...(Number.isInteger(host) && host > 0 ? { hostId: host } : {}),
        page: Number.isInteger(page) ? page : 1,
        pageSize: Number.isInteger(pageSize) ? pageSize : 50,
        raggruppa,
        exploit,
        stato,
        rete: intero("rete"),
        ospite: intero("ospite"),
        conIndicatori: q.get("indicatori") === "1",
        os,
        precedenti: q.get("precedenti") === "1",
        ordina,
        verso,
        exploitDi: exploitPerRotte().exploitDi,
        cvssDi: cvssPerRotte(),
      }),
    );
  });
}
