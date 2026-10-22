import { auth } from "@/lib/auth";
import { PaginaOpzioni } from "@/components/opzioni/pagina-opzioni";

export const metadata = {
  title: "Opzioni — DA-IPAM",
};

/**
 * Ogni funzione che si accende o si spegne, in un posto solo (spec pagina Opzioni, 22/10). La vedono tutti; la cambia
 * solo un amministratore (lo dice l'API, `puoCambiare`).
 */
export default async function OpzioniPage() {
  const sessione = await auth();
  const u = sessione?.user as { tenantCode?: string | null; tenants?: Array<{ code: string; name: string }> } | undefined;
  const codice = u?.tenantCode ?? "";
  const nome = u?.tenants?.find((t) => t.code === codice)?.name;
  const cliente = codice === "__ALL__" ? "tutti (vista aggregata)" : nome ? `${codice} · ${nome}` : codice || "—";
  return <PaginaOpzioni cliente={cliente} />;
}
