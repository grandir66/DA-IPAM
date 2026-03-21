import { NextResponse } from "next/server";
import { HostsBulkBaseSchema, HostsBulkKnownSchema } from "@/lib/validators";
import {
  bulkDeleteHosts,
  bulkUpdateHostsKnownHost,
  countHostsInNetwork,
} from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function PATCH(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const parsed = HostsBulkKnownSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { network_id, host_ids, known_host } = parsed.data;
    const unique = [...new Set(host_ids)];
    const ok = countHostsInNetwork(network_id, unique);
    if (ok !== unique.length) {
      return NextResponse.json(
        { error: "Uno o più host non appartengono alla rete indicata" },
        { status: 400 }
      );
    }
    const changes = bulkUpdateHostsKnownHost(network_id, unique, known_host);
    return NextResponse.json({ success: true, updated: changes });
  } catch (error) {
    console.error("Hosts bulk PATCH error:", error);
    return NextResponse.json({ error: "Errore nell'aggiornamento" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const parsed = HostsBulkBaseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { network_id, host_ids } = parsed.data;
    const unique = [...new Set(host_ids)];
    const ok = countHostsInNetwork(network_id, unique);
    if (ok !== unique.length) {
      return NextResponse.json(
        { error: "Uno o più host non appartengono alla rete indicata" },
        { status: 400 }
      );
    }
    const changes = bulkDeleteHosts(network_id, unique);
    return NextResponse.json({ success: true, deleted: changes });
  } catch (error) {
    console.error("Hosts bulk DELETE error:", error);
    return NextResponse.json({ error: "Errore nell'eliminazione" }, { status: 500 });
  }
}
