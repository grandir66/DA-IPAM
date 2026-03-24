import { NextRequest, NextResponse } from "next/server";
import { getNetworkById, getHostsByNetwork } from "@/lib/db";
import dns from "dns";
import { withTenantFromSession } from "@/lib/api-tenant";

/**
 * GET /api/networks/[id]/test-dns?ip=192.168.1.1
 *
 * Diagnostica DNS per una rete. Se `ip` specificato, testa solo quell'IP.
 * Altrimenti testa i primi 10 host della rete.
 *
 * Mostra: server DNS usato, risultato reverse, risultato forward, errori.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
    const network = getNetworkById(Number(id));
    if (!network) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }

    const testIp = request.nextUrl.searchParams.get("ip");
    const dnsServer = network.dns_server?.trim() || null;

    // Mostra configurazione
    const systemServers = dns.getServers();
    const config = {
      network_dns_server: dnsServer || "(non configurato — usa DNS di sistema)",
      system_dns_servers: systemServers,
      effective_server: dnsServer || systemServers[0] || "nessuno",
    };

    // Crea resolver con il server DNS della rete
    const resolver = new dns.promises.Resolver({ timeout: 5000, tries: 2 });
    if (dnsServer) {
      try {
        resolver.setServers([dnsServer]);
      } catch (err) {
        return NextResponse.json({
          config,
          error: `Formato server DNS non valido: "${dnsServer}". Usa solo IP (es. 192.168.1.1), senza porta.`,
          detail: (err as Error).message,
        });
      }
    }

    // Determina IP da testare
    let ipsToTest: string[];
    if (testIp) {
      ipsToTest = [testIp];
    } else {
      const hosts = getHostsByNetwork(Number(id));
      ipsToTest = hosts.slice(0, 10).map((h) => h.ip);
    }

    // Testa ogni IP
    const results = [];
    for (const ip of ipsToTest) {
      const result: Record<string, unknown> = { ip };

      // Reverse DNS (PTR)
      try {
        const hostnames = await resolver.reverse(ip);
        result.reverse_ok = true;
        result.reverse_result = hostnames;
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        result.reverse_ok = false;
        result.reverse_error = `${err.code}: ${err.message}`;
      }

      // Se reverse ha funzionato, prova forward
      if (result.reverse_ok && Array.isArray(result.reverse_result) && result.reverse_result.length > 0) {
        const hostname = result.reverse_result[0] as string;
        try {
          const addresses = await resolver.resolve4(hostname);
          result.forward_ok = true;
          result.forward_result = addresses;
          result.forward_matches_ip = addresses.includes(ip);
        } catch (e) {
          const err = e as NodeJS.ErrnoException;
          result.forward_ok = false;
          result.forward_error = `${err.code}: ${err.message}`;
        }
      }

      results.push(result);
    }

    return NextResponse.json({ config, results });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore" },
        { status: 500 }
      );
    }
  });
}
