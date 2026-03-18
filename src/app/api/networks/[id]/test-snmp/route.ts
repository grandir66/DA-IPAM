import { NextRequest, NextResponse } from "next/server";
import { getNetworkById, getHostsByNetwork } from "@/lib/db";
import { snmpDebugQuery } from "@/lib/scanner/snmp-debug";

/**
 * GET /api/networks/[id]/test-snmp?ip=192.168.1.1&community=public
 *
 * Diagnostica SNMP dettagliata: mostra varbinds raw, tipi, errori.
 * Senza ?ip= testa i primi 5 host della rete.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const network = getNetworkById(Number(id));
    if (!network) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }

    const ip = request.nextUrl.searchParams.get("ip");
    const community = request.nextUrl.searchParams.get("community") || network.snmp_community || "public";
    const port = parseInt(request.nextUrl.searchParams.get("port") || "161");

    let ipsToTest: string[];
    if (ip) {
      ipsToTest = [ip];
    } else {
      const hosts = getHostsByNetwork(Number(id));
      ipsToTest = hosts.slice(0, 5).map((h) => h.ip);
    }

    const results = [];
    for (const testIp of ipsToTest) {
      const r = await snmpDebugQuery(testIp, community, port);
      results.push(r);
    }

    // Prova anche con "public" se community custom non ha funzionato
    const noResponse = results.every((r) => !r.success || (!r.parsed.sysName && !r.parsed.sysDescr));
    let publicFallback = null;
    if (noResponse && community !== "public" && ipsToTest.length === 1) {
      publicFallback = await snmpDebugQuery(ipsToTest[0], "public", port);
    }

    return NextResponse.json({
      config: {
        network_snmp_community: network.snmp_community || "(non configurata nella rete)",
        tested_community: community,
        port,
      },
      results,
      ...(publicFallback ? { fallback_public: publicFallback } : {}),
      help: noResponse ? [
        "Nessuna risposta SNMP. Possibili cause:",
        `1. La community '${community}' non è corretta per questi device`,
        "2. SNMP non è abilitato sui device (verificare configurazione device)",
        "3. Firewall blocca UDP 161 tra questo server e i device",
        `4. Testa da terminale: snmpget -v2c -c ${community} ${ipsToTest[0]} 1.3.6.1.2.1.1.1.0`,
        "5. Se il test da terminale funziona ma qui no, potrebbe essere un problema di routing/binding di net-snmp",
      ] : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore" },
      { status: 500 }
    );
  }
}
