import { NextResponse } from "next/server";
import { getNmapProfiles, createNmapProfile, updateNmapProfile, deleteNmapProfile } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function GET() {
  try {
    const authCheck = await requireAdmin();
    if (isAuthError(authCheck)) return authCheck;
    const profiles = getNmapProfiles();
    return NextResponse.json(profiles);
  } catch (error) {
    console.error("Error fetching nmap profiles:", error);
    return NextResponse.json({ error: "Errore nel recupero profili" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const existing = getNmapProfiles();
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "È supportato un solo profilo Nmap. Modificalo da Impostazioni → Profilo Nmap." },
        { status: 400 }
      );
    }
    const { name, description, args, snmp_community, custom_ports, tcp_ports, udp_ports } = await request.json();
    if (!name) {
      return NextResponse.json({ error: "Nome richiesto" }, { status: 400 });
    }
    const hasTcpPorts = tcp_ports !== undefined && tcp_ports !== null && String(tcp_ports).trim() !== "";
    const isCustomProfile = custom_ports !== undefined && custom_ports !== null;
    const useArgs = hasTcpPorts ? "" : isCustomProfile ? "" : (args ?? "");
    if (!hasTcpPorts && !isCustomProfile && !useArgs) {
      return NextResponse.json({ error: "Indica le porte TCP o gli argomenti nmap" }, { status: 400 });
    }
    const profile = createNmapProfile(
      name,
      description || "",
      useArgs,
      snmp_community || null,
      custom_ports ?? null,
      hasTcpPorts ? String(tcp_ports).trim() : null,
      udp_ports !== undefined && udp_ports !== null ? String(udp_ports) : null
    );
    return NextResponse.json(profile, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "Esiste già un profilo con questo nome" }, { status: 409 });
    }
    if (error instanceof Error && error.message.includes("solo profilo")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error creating nmap profile:", error);
    return NextResponse.json({ error: "Errore nella creazione" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id, name, description, args, snmp_community, custom_ports, tcp_ports, udp_ports } = await request.json();
    if (!id || !name) {
      return NextResponse.json({ error: "ID e nome richiesti" }, { status: 400 });
    }
    // Priorità: tcp_ports esplicito > custom_ports > args
    const hasTcpPorts = tcp_ports !== undefined && tcp_ports !== null && tcp_ports !== "";
    const isCustomProfile = custom_ports !== undefined && custom_ports !== null;
    const useArgs = hasTcpPorts ? "" : (isCustomProfile ? "" : (args ?? ""));
    if (!hasTcpPorts && !isCustomProfile && !useArgs) {
      return NextResponse.json({ error: "Porte TCP o argomenti nmap richiesti" }, { status: 400 });
    }
    const profile = updateNmapProfile(
      id, name, description || "", useArgs, snmp_community ?? null, 
      hasTcpPorts ? null : (custom_ports ?? null),
      hasTcpPorts ? tcp_ports : null,
      udp_ports ?? null
    );
    return NextResponse.json(profile);
  } catch (error) {
    console.error("Error updating nmap profile:", error);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "ID richiesto" }, { status: 400 });
    }
    const deleted = deleteNmapProfile(id);
    if (!deleted) {
      return NextResponse.json({ error: "Profilo non trovato o non eliminabile (profilo di default)" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting nmap profile:", error);
    return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
  }
}
