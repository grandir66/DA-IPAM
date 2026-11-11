import Link from "next/link";
import { IntestazionePagina, Pannello, Vuoto } from "@/components/shared/console";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getServerTenantCode } from "@/lib/api-tenant";
import { getTenantDb } from "@/lib/db-tenant";
import { leggiCambiRete, type CambioRete } from "@/lib/scanner/confronto-giri-db";

const etichette: Record<CambioRete["kind"], string> = {
  host_nuovo: "Nuovo host osservato",
  mac_cambiato: "MAC cambiato",
  porta_nuova: "Porta passata da chiusa ad aperta",
  porta_rilevata: "Porta appena osservata",
};
const dataOra = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Rome" });

function interoPositivo(valore: string | string[] | undefined): number | undefined {
  if (typeof valore !== "string" || !/^\d+$/.test(valore)) return;
  const numero = Number(valore);
  if (Number.isSafeInteger(numero) && numero > 0) return numero;
}

export default async function NetworkChangesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametri = await searchParams;
  const rete = interoPositivo(parametri.rete);
  const pagina = Math.min(interoPositivo(parametri.pagina) ?? 1, 1_000_000);
  const tenant = await getServerTenantCode();
  const { reti, righe, successiva, confrontato } = leggiCambiRete(getTenantDb(tenant), pagina, rete);
  const linkPagina = (p: number) => `/network-changes?pagina=${p}${rete ? `&rete=${rete}` : ""}`;

  return (
    <div className="space-y-4">
      <IntestazionePagina
        titolo="Network Changes"
        sottotitolo="Cambiamenti tra giri di Discovery per tutte le subnet."
      />
      <Pannello
        titolo="Cambiamenti"
        sottotitolo="Ultimi 90 giorni"
        corpoClassName="p-0"
        azioni={reti.length > 0 && (
          <form className="flex items-center gap-2" action="/network-changes">
            <select
              aria-label="Subnet"
              className="h-8 max-w-64 rounded-md border border-input bg-background px-2 text-sm"
              name="rete"
              defaultValue={rete ?? ""}
            >
              <option value="">Tutte le subnet</option>
              {reti.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.cidr}</option>)}
            </select>
            <Button type="submit" variant="outline" size="sm">Filtra</Button>
          </form>
        )}
        piede={(pagina > 1 || successiva) && (
          <nav className="flex items-center gap-3" aria-label="Paginazione dei cambiamenti">
            {pagina > 1 && <Link className="text-cian-testo hover:underline" href={linkPagina(pagina - 1)}>Precedente</Link>}
            <span>Pagina {pagina}</span>
            {successiva && <Link className="text-cian-testo hover:underline" href={linkPagina(pagina + 1)}>Successiva</Link>}
          </nav>
        )}
      >
        {righe.length > 0 ? (
          <Table fissa riserva={pagina > 1 || successiva ? 52 : 0}>
            <TableHeader>
              <TableRow>
                <TableHead>Rilevato il</TableHead>
                <TableHead>Subnet</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Cambiamento</TableHead>
                <TableHead>Evidenza</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {righe.map((riga) => (
                <TableRow key={riga.id}>
                  <TableCell className="font-mono">{dataOra.format(riga.finished_ms)}</TableCell>
                  <TableCell>
                    <Link className="text-cian-testo hover:underline" href={`/networks/${riga.network_id}`}>
                      {riga.nome_rete}
                    </Link>
                    <span className="ml-2 font-mono text-muted-foreground">{riga.cidr}</span>
                  </TableCell>
                  <TableCell className="font-mono">{riga.ip}</TableCell>
                  <TableCell>{etichette[riga.kind]}</TableCell>
                  <TableCell className="font-mono">
                    {riga.before_value && <>{riga.before_value} → </>}
                    {riga.after_value}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Vuoto
            titolo={pagina > 1 ? "Nessun cambiamento in questa pagina" :
              confrontato ? "Nessun cambiamento registrato" : "In attesa di due giri comparabili"}
            testo={pagina === 1 && !confrontato ? "Per ogni subnet, Discovery confronta i giri completati sullo stesso perimetro e con le stesse opzioni TCP." : undefined}
          />
        )}
      </Pannello>
    </div>
  );
}
