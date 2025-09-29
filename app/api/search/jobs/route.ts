import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";

const payloadSchema = z.object({
  queryText: z.string().min(2),
  niceClasses: z.array(z.number().int().min(1).max(45)).nonempty(),
  territory: z.enum(["FR", "EU"]),
});

export async function POST(req: Request) {
  try {
  const { userId } = await auth(); // <- IMPORTANT
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const json = await req.json();
    const data = payloadSchema.parse(json);

    let user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) {
      user = await prisma.user.create({
        data: { clerkId: userId, email: `${userId}@example.local` },
      });
    }

    const job = await prisma.searchJob.create({
      data: {
        userId: user.id,
        queryText: data.queryText,
        niceClasses: data.niceClasses,
        territory: data.territory,
        status: "PENDING",
      },
    });

    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
}
