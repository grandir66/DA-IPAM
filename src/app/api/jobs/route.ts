import { NextResponse } from "next/server";
import { getScheduledJobs, createScheduledJob, toggleJob, deleteScheduledJob } from "@/lib/db";
import { ScheduledJobSchema } from "@/lib/validators";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function GET() {
  try {
    const authCheck = await requireAdmin();
    if (isAuthError(authCheck)) return authCheck;
    return NextResponse.json(getScheduledJobs());
  } catch (error) {
    console.error("Error fetching jobs:", error);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const parsed = ScheduledJobSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const job = createScheduledJob(parsed.data);
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    console.error("Error creating job:", error);
    return NextResponse.json({ error: "Errore nella creazione" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const { id, enabled } = body;
    if (typeof id !== "number" || typeof enabled !== "boolean") {
      return NextResponse.json({ error: "Parametri non validi" }, { status: 400 });
    }
    toggleJob(id, enabled);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating job:", error);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID richiesto" }, { status: 400 });
    deleteScheduledJob(Number(id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting job:", error);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}
