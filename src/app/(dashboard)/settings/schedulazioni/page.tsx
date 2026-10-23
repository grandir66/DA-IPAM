import { auth } from "@/lib/auth";
import { PaginaSchedulazioni } from "@/components/schedulazioni/pagina-schedulazioni";

export const metadata = {
  title: "Schedulazioni — DA-IPAM",
};

/**
 * Tutto ciò che parte da solo, in un elenco unico (tavola del 22/10, oggetti 21-30). La vedono tutti; accende e spegne
 * solo un amministratore (lo dice l'API, `puoCambiare`).
 */
export default async function SchedulazioniPage() {
  const sessione = await auth();
  const u = sessione?.user as { tenantCode?: string | null; tenants?: Array<{ code: string; name: string }> } | undefined;
  const codice = u?.tenantCode ?? "";
  const nome = u?.tenants?.find((t) => t.code === codice)?.name;
  const cliente = codice === "__ALL__" ? "tutti (vista aggregata)" : nome ? `${codice} · ${nome}` : codice || "—";
  return <PaginaSchedulazioni cliente={cliente} />;
}
