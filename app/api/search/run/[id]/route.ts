// app/api/search/run/[id]/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ensureUserRecord } from "@/lib/ensureUser";
import { prisma } from "@/lib/db";
import { searchINPI } from "@/lib/connectors/inpi";
import { searchEUIPO } from "@/lib/connectors/euipo";
import {
  jaroWinkler,
  levenshteinNorm,
  metaphoneMatch,
  cosineSim,
} from "@/lib/similarity";
import { embedText } from "@/lib/embeddings";
import { JobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

// Next 15: params est une Promise
type Ctx = { params: Promise<{ id: string }> };

type RawHit = {
  markText?: string;
  classes?: number[];
  source?: string;
  applicationNo?: string | null;
  status?: string | null;
  statusLabel?: string | null;
  niceOwner?: string | null;
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}
function riskFromAggregate(s: number): "HIGH" | "MEDIUM" | "LOW" {
  if (s >= 0.75) return "HIGH";
  if (s >= 0.55) return "MEDIUM";
  return "LOW";
}
function normText(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
function toErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

// Helper to protect and sanitize EUIPO calls behind a flag, tolerant to failure
async function safeEUIPO(
  query: string,
  classes: number[],
  limit: number,
  errors?: { source: string; error: string }[]
): Promise<RawHit[]> {
  const enabled = /^(1|true|yes|on)$/i.test(process.env.EUIPO_ENABLED ?? "");
  if (!enabled) {
    console.info("[EUIPO] disabled by flag");
    return [];
  }
  try {
    const euipo = await searchEUIPO(query, classes, limit);
    return (euipo ?? []).map((h: any) => ({
      markText: h.sign,
      classes: h.niceClasses,
      source: "EUIPO",
      applicationNo: h.sourceId,
      status: h.status,
      statusLabel: h.status,
      niceOwner: h.holder ?? null,
    }));
  } catch (e) {
    const msg = toErr(e);
    console.warn("[EUIPO] connector failed:", msg);
    if (errors) errors.push({ source: "EUIPO", error: msg });
    return [];
  }
}

export async function POST(_req: Request, { params }: Ctx) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ✅ Normalise/garantit l’utilisateur en DB (et récupère son id interne)
  const dbUser = await ensureUserRecord(userId);

  const { id: rawId } = await params; // Next 15 → Promise
  const jobId = decodeURIComponent(String(rawId)).trim();

  // 1) Cherche strict: id + dbUser.id (pas le clerkId)
  let job = await prisma.searchJob.findFirst({
    where: { id: jobId, userId: dbUser.id },
  });

  // 2) DEV ONLY – adopter un job orphelin ou d’un autre user
  if (!job) {
    const isDev = process.env.NODE_ENV !== "production";
    const anyJob = await prisma.searchJob.findUnique({ where: { id: jobId } });

    if (isDev && anyJob) {
      const fromUser = anyJob.userId ?? null;
      if (fromUser == null || fromUser !== dbUser.id) {
        console.warn("[run] adopting job (dev)", {
          jobId,
          previousUser: fromUser,
          newUser: dbUser.id,
        });

        // ✅ rattache au user interne (FK sûre)
        await prisma.searchJob.update({
          where: { id: jobId },
          data: { userId: dbUser.id },
        });

        // recharge
        job = await prisma.searchJob.findFirst({
          where: { id: jobId, userId: dbUser.id },
        });
      }
    }
  }

  // 3) Si toujours rien → 404 avec log clair
  if (!job) {
    const exists = await prisma.searchJob.count({ where: { id: jobId } });
    console.warn("[run] job not found", { jobId, forUser: dbUser.id, exists });
    return NextResponse.json(
      { error: "not_found", details: { exists } },
      { status: 404 }
    );
  }

  // Marquer RUNNING
  await prisma.searchJob.update({
    where: { id: job.id },
    data: { status: JobStatus.RUNNING },
  });
  const connectorErrors: { source: string; error: string }[] = [];

  try {
    // 1) Récupération des hits bruts
    const limit = 50;
    const classes = job.niceClasses ?? [];

    let rawHits: RawHit[] = [];
    if (job.territory === "FR") {
      rawHits = (await searchINPI(job.queryText, classes, limit)) as RawHit[];
    } else if (job.territory === "EU") {
      // Appel protégé par flag + tolérant à l'échec
      rawHits = await safeEUIPO(job.queryText, classes, limit, connectorErrors);
    } else {
      // FR + EU combinés, chaque branche tolère l'échec et renvoie []
      const [frMapped, euMapped] = await Promise.all([
        (async () => {
          try {
            return ((await searchINPI(job.queryText, classes, limit)) as RawHit[]) ?? [];
          } catch (e) {
            console.warn("INPI connector failed:", toErr(e));
            connectorErrors.push({ source: "INPI", error: toErr(e) });
            return [];
          }
        })(),
        safeEUIPO(job.queryText, classes, limit, connectorErrors),
      ]);

      rawHits = [...frMapped, ...euMapped];
    }

    // 2) Embedding du terme recherché (peut renvoyer null si flag OFF / quota)
    const queryEmbedding = await embedText(job.queryText);

    // 3) Similarités
    const enriched: any[] = [];
    for (const h of rawHits) {
      const a = job.queryText ?? "";
      const b = h?.markText ?? "";

      const jw = clamp01(jaroWinkler(a, b) ?? 0);
      const lev = clamp01(levenshteinNorm(a, b) ?? 0);
      const ph = clamp01(metaphoneMatch(a, b) ?? 0);

      let sem = 0;
      let markEmbedding: number[] = [];

      if (queryEmbedding && queryEmbedding.length > 0) {
        const emb = await embedText(b);
        if (emb && emb.length > 0) {
          sem = clamp01(cosineSim(queryEmbedding, emb) ?? 0);
          markEmbedding = emb;
        }
      }

      const aggregate = clamp01(0.35 * jw + 0.35 * lev + 0.2 * ph + 0.1 * sem);
      const risk = riskFromAggregate(aggregate);

      enriched.push({
        markText: b,
        classes: Array.isArray(h?.classes) ? h.classes : [],
        source: h?.source ?? "INPI",
        applicationNo: h?.applicationNo ?? null,
        statusLabel: h?.statusLabel ?? h?.status ?? null,
        status: h?.status ?? null,
        niceOwner: h?.niceOwner ?? null,
        similarityJson: { jw, lev, ph, sem, aggregate },
        risk,
        markEmbedding, // Float[] NOT NULL → tableau poss. vide
      });
    }

    // 4) Dédoublonnage
    const byKey = new Map<string, any>();
    for (const h of enriched) {
      const key = `${normText(h.markText)}|${(h.classes ?? [])
        .slice()
        .sort((a: number, b: number) => a - b)
        .join("-")}`;

      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { ...h, sources: [h.source] });
      } else {
        const sa = (prev.similarityJson?.aggregate ?? 0) as number;
        const sb = (h.similarityJson?.aggregate ?? 0) as number;
        const best = sb > sa ? h : prev;
        byKey.set(key, {
          ...best,
          sources: Array.from(new Set([...(prev.sources ?? []), h.source])),
          statusLabel: prev.statusLabel ?? h.statusLabel,
          status: prev.status ?? h.status,
          applicationNo: prev.applicationNo ?? h.applicationNo,
        });
      }
    }

    const dedupedHits = Array.from(byKey.values());

    // 5) Persistance
    await prisma.hit.deleteMany({ where: { jobId: job.id } });
    if (dedupedHits.length > 0) {
      await prisma.hit.createMany({
        data: dedupedHits.map((h: any) => ({
          jobId: job.id,
          markText: h.markText,
          classes: h.classes,
          source: h.source,
          applicationNo: h.applicationNo,
          statusLabel: h.statusLabel,
          similarityJson: h.similarityJson,
          risk: h.risk,
          markEmbedding: Array.isArray(h.markEmbedding) ? h.markEmbedding : [],
        })),
      });
    }

    // 6) Résumé global (MVP)
    const top =
      dedupedHits
        .map((h: any) => h.similarityJson?.aggregate ?? 0)
        .reduce((m: number, v: number) => (v > m ? v : m), 0) ?? 0;
    const global_risk = riskFromAggregate(top);
    const recommendations: string[] = [
      global_risk === "HIGH"
        ? "Risque élevé : envisager une variante orthographique."
        : global_risk === "MEDIUM"
        ? "Risque moyen : resserrer le libellé (classes/produits)."
        : "Risque faible : dépôt envisageable sous réserve d’une validation finale.",
    ];

    await prisma.searchJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.DONE,
        resultJson: { global_risk, recommendations, connector_errors: connectorErrors },
      },
    });

    return NextResponse.json({ ok: true, hits: dedupedHits.length });
  } catch (e) {
    console.error("run worker error", e);
    await prisma.searchJob.update({
      where: { id: job.id },
      data: { status: JobStatus.ERROR },
    });
    return NextResponse.json({ error: "worker_failed" }, { status: 500 });
  }
}