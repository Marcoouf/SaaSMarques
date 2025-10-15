import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ensureUserRecord } from "@/lib/ensureUser";
import { auth } from "@clerk/nextjs/server";
import { JobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  queryText: z.string().min(2),
  niceClasses: z.array(z.number().int().min(1).max(45)).nonempty(),
  territory: z.enum(["FR", "EU"]),
});

export async function POST(req: Request) {
  try {
    // Clerk auth : on récupère l'ID Clerk et on s'assure qu'il est présent
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Valide la charge utile
    const json = await req.json();
    const data = payloadSchema.parse(json);

    // S'assure qu'un User interne existe pour ce clerkId
    const user = await ensureUserRecord(clerkId);

    // We store the internal User ID (user.id) in SearchJob.userId to keep consistency with the run endpoint.
    const job = await prisma.searchJob.create({
      data: {
        userId: user.id,                 // <-- clé étrangère vers User(id)
        queryText: data.queryText,
        niceClasses: data.niceClasses,
        territory: data.territory,
        status: JobStatus.PENDING,
      },
    });

    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (err: any) {
    console.error("[jobs.create] error:", err?.message || err);
    return NextResponse.json({ ok: false, error: err?.message || "bad_request" }, { status: 400 });
  }
}
