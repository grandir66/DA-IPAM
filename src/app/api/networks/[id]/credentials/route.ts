import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getNetworkById,
  getNetworkCredentials,
  replaceNetworkCredentials,
  addNetworkCredential,
  removeNetworkCredential,
  copyNetworkCredentials,
  getNetworksWithCredentials,
} from "@/lib/db";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";

/** GET — lista credenziali assegnate alla subnet (ordinate). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    const { id } = await params;
    const networkId = Number(id);
    const network = getNetworkById(networkId);
    if (!network) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }
    const credentials = getNetworkCredentials(networkId);
    const networksWithCreds = getNetworksWithCredentials().filter((n) => n.id !== networkId);
    return NextResponse.json({ credentials, available_sources: networksWithCreds });
  } catch (error) {
    console.error("Error fetching network credentials:", error);
    return NextResponse.json({ error: "Errore nel recupero credenziali" }, { status: 500 });
  }
}

const PutSchema = z.object({
  credential_ids: z.array(z.number().int().positive()),
});

/** PUT — sostituisce la lista credenziali della subnet (ordine = posizione nell'array). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const networkId = Number(id);
    const network = getNetworkById(networkId);
    if (!network) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    replaceNetworkCredentials(networkId, parsed.data.credential_ids);
    const credentials = getNetworkCredentials(networkId);
    return NextResponse.json({ credentials });
  } catch (error) {
    console.error("Error updating network credentials:", error);
    return NextResponse.json({ error: "Errore nell'aggiornamento credenziali" }, { status: 500 });
  }
}

const PostSchema = z.object({
  action: z.enum(["add", "remove", "copy"]),
  credential_id: z.number().int().positive().optional(),
  source_network_id: z.number().int().positive().optional(),
});

/** POST — azioni: add, remove, copy (da altra subnet). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const networkId = Number(id);
    const network = getNetworkById(networkId);
    if (!network) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { action, credential_id, source_network_id } = parsed.data;

    if (action === "add") {
      if (!credential_id) {
        return NextResponse.json({ error: "credential_id richiesto" }, { status: 400 });
      }
      addNetworkCredential(networkId, credential_id);
    } else if (action === "remove") {
      if (!credential_id) {
        return NextResponse.json({ error: "credential_id richiesto" }, { status: 400 });
      }
      removeNetworkCredential(networkId, credential_id);
    } else if (action === "copy") {
      if (!source_network_id) {
        return NextResponse.json({ error: "source_network_id richiesto" }, { status: 400 });
      }
      const sourceNetwork = getNetworkById(source_network_id);
      if (!sourceNetwork) {
        return NextResponse.json({ error: "Rete sorgente non trovata" }, { status: 404 });
      }
      const added = copyNetworkCredentials(source_network_id, networkId);
      const credentials = getNetworkCredentials(networkId);
      return NextResponse.json({ credentials, added });
    }

    const credentials = getNetworkCredentials(networkId);
    return NextResponse.json({ credentials });
  } catch (error) {
    console.error("Error managing network credentials:", error);
    return NextResponse.json({ error: "Errore nella gestione credenziali" }, { status: 500 });
  }
}
