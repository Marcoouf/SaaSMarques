// THIS FILE IS AUTO-REPLACED BY INSTRUCTIONS.
"use client";

import { useEffect, useMemo, useState } from "react";

type ApiJob = {
  id: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  resultJson?: {
    global_risk?: "low" | "medium" | "high";
    recommendations?: string[];
  };
  hits?: any[];
};

type ApiResult = {
  ok?: boolean;
  job?: ApiJob & { hits: any[] };
  error?: string;
};

const badgeColorsByStatus: Record<ApiJob["status"], string> = {
  PENDING: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
  RUNNING: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200",
  DONE: "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200",
  FAILED: "bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200",
};

function StatusBadge({ status }: { status?: ApiJob["status"] }) {
  const cls = status ? badgeColorsByStatus[status] : "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status ?? "—"}
    </span>
  );
}

function RiskBadge({ risk }: { risk?: string }) {
  if (!risk) return <span className="rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200 px-2.5 py-0.5 text-xs text-slate-700">—</span>;
  const r = risk.toLowerCase();
  const cls =
    r === "high"
      ? "bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200"
      : r === "medium"
      ? "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200"
      : "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{risk}</span>;
}

function formatScore(n?: number) {
  return typeof n === "number" ? n.toFixed(2) : "—";
}

function SkeletonRow() {
  return (
    <tr className="border-t animate-pulse">
      <td className="px-4 py-3"><div className="h-3 w-28 rounded bg-slate-200" /></td>
      <td className="px-4 py-3"><div className="h-3 w-12 rounded bg-slate-200" /></td>
      <td className="px-4 py-3"><div className="h-3 w-16 rounded bg-slate-200" /></td>
      <td className="px-4 py-3"><div className="h-3 w-24 rounded bg-slate-200" /></td>
      <td className="px-4 py-3"><div className="h-3 w-12 rounded bg-slate-200" /></td>
      <td className="px-4 py-3"><div className="h-3 w-14 rounded bg-slate-200" /></td>
    </tr>
  );
}

const LS_KEYS = {
  job: "sm:lastJobId",
  q: "sm:lastQuery",
  cl: "sm:lastClasses",
  t: "sm:lastTerritory",
};

function scoreFromHit(hit: any): number {
  const agg = hit?.similarityJson?.aggregate as number | undefined;
  if (typeof agg === "number") return Math.max(0, Math.min(1, agg));
  const jw = hit?.similarityJson?.jw ?? 0;
  const lev = hit?.similarityJson?.lev ?? 0;
  const ph = hit?.similarityJson?.ph ?? 0;
  const sem = hit?.similarityJson?.sem ?? 0;
  const s = 0.35 * jw + 0.35 * lev + 0.2 * ph + 0.1 * sem;
  return Math.max(0, Math.min(1, s));
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export default function Dashboard() {
  const [queryText, setQueryText] = useState("");
  const [classes, setClasses] = useState<string>("9");
  const [territory, setTerritory] = useState<"FR" | "EU">("FR");
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Filters & sorting
  const [minScorePct, setMinScorePct] = useState<number>(60); // 60% par défaut
  const [riskFilter, setRiskFilter] = useState<"ALL" | "HIGH" | "MEDIUM" | "LOW">("ALL");
  const [sortBy, setSortBy] = useState<"aggregate" | "jw" | "lev">("aggregate");

  // helper: filtre risque
  function riskOkFor(hit: any) {
    if (riskFilter === "ALL") return true;
    const r = (hit?.risk ?? "").toUpperCase();
    return r === riskFilter;
  }

  // Restore last session from localStorage
  useEffect(() => {
    try {
      const lastQ = localStorage.getItem(LS_KEYS.q) || "";
      const lastCl = localStorage.getItem(LS_KEYS.cl) || "9";
      const lastT = (localStorage.getItem(LS_KEYS.t) as "FR" | "EU") || "FR";
      setQueryText(lastQ);
      setClasses(lastCl);
      setTerritory(lastT);
      const lastJob = localStorage.getItem(LS_KEYS.job);
      if (lastJob) {
        setJobId(lastJob);
        // lazy refresh; we don't await here to avoid blocking paint
        refresh(lastJob);
      }
    } catch {}
  }, []);

  const status: ApiJob["status"] | undefined = result?.job?.status;

  async function createJob() {
    if (!queryText.trim()) {
      alert("Renseigne un nom de marque.");
      return;
    }

    const niceClasses = classes
      .split(",")
      .map((s: string) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));

    // persist current form values
    try {
      localStorage.setItem(LS_KEYS.q, queryText);
      localStorage.setItem(LS_KEYS.cl, classes);
      localStorage.setItem(LS_KEYS.t, territory);
    } catch {}

    setSubmitting(true);
    try {
      const r = await fetch("/api/search/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queryText, niceClasses, territory }),
      }).then((x) => x.json());

      if (r.ok && r.jobId) {
        setJobId(r.jobId as string);
        try { localStorage.setItem(LS_KEYS.job, r.jobId as string); } catch {}
        await runJob(r.jobId as string); // déclenche le worker côté serveur
        await refresh(r.jobId as string); // puis on recharge l'état du job
      } else {
        alert(r.error ?? "Erreur");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function runJob(id: string) {
    await fetch(`/api/search/run/${id}`, { method: "POST" });
  }

  async function refresh(id?: string) {
    const effective = id ?? jobId;
    if (!effective) return;
    setRefreshing(true);
    try {
      const r: ApiResult = await fetch(`/api/search/jobs/${effective}`).then((x) => x.json());
      setResult(r);
      try { if (effective) localStorage.setItem(LS_KEYS.job, effective); } catch {}
    } finally {
      setRefreshing(false);
    }
  }

  // Export des résultats en CSV
  function exportCsv(rows: any[]) {
    const header = ["Sign", "Classes", "Source", "Status", "Score", "Risk"];
    const matrix = [
      header,
      ...rows.map((h: any) => {
        const score = scoreFromHit(h);
        return [
          (h?.markText ?? "").toString().replaceAll('"', '""'),
          Array.isArray(h?.classes) ? h.classes.join(" ") : "",
          h?.source ?? "",
          h?.statusLabel ?? h?.applicationNo ?? "",
          score.toFixed(3),
          h?.risk ?? "",
        ];
      }),
    ];
    const csv = matrix.map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hits_${jobId ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: any;
    const tick = async () => {
      if (cancelled) return;
      const res: ApiResult = await fetch(`/api/search/jobs/${jobId}`).then((x) => x.json());
      if (cancelled) return;
      setResult(res);
      const st = res?.job?.status;
      if (st && ["DONE", "FAILED"].includes(st)) return; // stop polling
      timer = setTimeout(tick, 1500);
    };
    timer = setTimeout(tick, 900);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId]);

  const sortedHits = useMemo(() => {
    const hits = result?.job?.hits ?? [];
    const minScore = (minScorePct || 0) / 100;

    const filtered = hits.filter((h: any) => {
      return scoreFromHit(h) >= minScore && riskOkFor(h);
    });

    const sorted = [...filtered].sort((a: any, b: any) => {
      const agA = (a?.similarityJson?.aggregate as number | undefined) ?? 0;
      const agB = (b?.similarityJson?.aggregate as number | undefined) ?? 0;
      const jwA = (a?.similarityJson?.jw as number | undefined) ?? 0;
      const jwB = (b?.similarityJson?.jw as number | undefined) ?? 0;
      const lvA = (a?.similarityJson?.lev as number | undefined) ?? 0;
      const lvB = (b?.similarityJson?.lev as number | undefined) ?? 0;

      if (sortBy === "jw") return jwB - jwA || lvB - lvA || agB - agA;
      if (sortBy === "lev") return lvB - lvA || jwB - jwA || agB - agA;
      // aggregate par défaut
      return agB - agA || jwB - jwA || lvB - lvA;
    });

    return sorted;
  }, [result?.job?.hits, minScorePct, riskFilter, sortBy]);

  const apiUrl = jobId ? `/api/search/jobs/${jobId}` : null;

  return (
    <main className="mx-auto max-w-5xl p-6 md:p-8 space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nouvelle recherche</h1>
          <p className="mt-1 text-sm text-slate-500">Vérifie les conflits potentiels avant un dépôt INPI/EUIPO.</p>
        </div>
        <div className="flex items-center gap-2">
          {result?.job?.resultJson?.global_risk && (
            <div className="hidden sm:flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
              <span className="text-slate-600">Risque global :</span>
              <RiskBadge risk={result.job.resultJson.global_risk} />
            </div>
          )}
          {status && <StatusBadge status={status} />}
        </div>
      </header>

      {/* Form */}
      <section className="rounded-lg border bg-white p-4 md:p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <input
            className="rounded border px-3 py-2 md:col-span-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
            placeholder="Nom de marque (ex: MERÉA)"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createJob(); }}
          />
          <input
            className="rounded border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
            placeholder="Classes Nice (ex: 9,35)"
            value={classes}
            onChange={(e) => setClasses(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createJob(); }}
          />
          <select
            className="rounded border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
            value={territory}
            onChange={(e) => setTerritory(e.target.value as any)}
          >
            <option value="FR">France (INPI)</option>
            <option value="EU">Union européenne (EUIPO)</option>
          </select>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={createJob}
            disabled={isSubmitting || !queryText.trim()}
            className="rounded-md bg-black px-4 py-2 text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Lancement..." : "Lancer la recherche (MVP)"}
          </button>

          {jobId && (
            <>
              <button
                onClick={() => refresh()}
                disabled={isRefreshing}
                className="rounded-md border px-3 py-2 text-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRefreshing ? "Rafraîchissement..." : "Rafraîchir le statut"}
              </button>
              <button
                onClick={() => {
                  setQueryText("");
                  setClasses("9");
                  setTerritory("FR");
                  setJobId(null);
                  setResult(null);
                  try {
                    localStorage.removeItem(LS_KEYS.job);
                    localStorage.removeItem(LS_KEYS.q);
                    localStorage.removeItem(LS_KEYS.cl);
                    localStorage.removeItem(LS_KEYS.t);
                  } catch {}
                }}
                className="rounded-md border px-3 py-2 text-sm transition hover:bg-slate-50"
              >
                Nouvelle recherche
              </button>

              <div className="ml-auto flex items-center gap-2 text-xs text-slate-600">
                <span className="truncate">Job ID :</span>
                <code className="rounded bg-slate-50 px-2 py-1 ring-1 ring-inset ring-slate-200">{jobId}</code>
                <button
                  onClick={async () => {
                    try { await navigator.clipboard?.writeText(jobId); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
                  }}
                  className="rounded-md border px-2 py-1 transition hover:bg-slate-50"
                  title="Copier l'identifiant"
                >
                  {copied ? "Copié" : "Copier"}
                </button>
                {apiUrl && (
                  <a
                    href={apiUrl}
                    target="_blank"
                    className="rounded-md border px-2 py-1 transition hover:bg-slate-50"
                    rel="noreferrer"
                  >
                    API JSON
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Results */}
      {jobId && (
        <section className="space-y-4">
          {/* Toolbar des résultats */}
          <div className="flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600">Score min.</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={minScorePct}
                  onChange={(e) => setMinScorePct(Number(e.target.value))}
                  className="w-40"
                />
                <span className="w-10 tabular-nums text-right text-sm text-slate-700">{minScorePct}%</span>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600">Risque</label>
                <select
                  value={riskFilter}
                  onChange={(e) => setRiskFilter(e.target.value as any)}
                  className="rounded border px-2 py-1 text-sm"
                >
                  <option value="ALL">Tous</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600">Tri</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="rounded border px-2 py-1 text-sm"
                >
                  <option value="aggregate">Aggregate</option>
                  <option value="jw">Jaro-Winkler</option>
                  <option value="lev">Levenshtein</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600">{sortedHits.length} résultat{sortedHits.length > 1 ? "s" : ""}</span>
              <button
                onClick={() => exportCsv(sortedHits)}
                className="rounded border px-3 py-2 text-sm hover:bg-slate-50"
              >
                Export CSV
              </button>
            </div>
          </div>
          {/* Hits */}
          {Array.isArray(sortedHits) && sortedHits.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr className="text-left text-slate-600">
                    <th className="px-4 py-3 font-medium">Signe</th>
                    <th className="px-4 py-3 font-medium">Classes</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Statut</th>
                    <th className="px-4 py-3 font-medium">Score</th>
                    <th className="px-4 py-3 font-medium">Risque</th>
                  </tr>
                </thead>
                <tbody className="[&>tr:nth-child(odd)]:bg-white [&>tr:nth-child(even)]:bg-slate-50/50">
                  {sortedHits.map((hit: any, i: number) => {
                    return (
                      <tr key={i} className="border-t hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium">{hit?.markText ?? "—"}</td>
                        <td className="px-4 py-3">{Array.isArray(hit?.classes) ? hit.classes.join(", ") : "—"}</td>
                        <td className="px-4 py-3">{hit?.source ?? "—"}</td>
                        <td className="px-4 py-3">{hit?.statusLabel ?? hit?.applicationNo ?? "—"}</td>
                        <td className="px-4 py-3 tabular-nums">
                          {(() => {
                            const s = scoreFromHit(hit);
                            return (
                              <div className="min-w-[140px]">
                                <div className="flex items-center justify-between text-xs text-slate-500">
                                  <span>{formatScore(s)}</span>
                                  <span>{pct(s)}</span>
                                </div>
                                <div className="mt-1 h-1.5 w-full rounded bg-slate-200">
                                  <div
                                    className="h-1.5 rounded"
                                    style={{
                                      width: `${s * 100}%`,
                                      background:
                                        (hit?.risk?.toLowerCase?.() === "high")
                                          ? "#ef4444"
                                          : (hit?.risk?.toLowerCase?.() === "medium")
                                          ? "#f59e0b"
                                          : "#10b981",
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3"><RiskBadge risk={hit?.risk} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border bg-white p-6 text-sm text-slate-600 shadow-sm">
              {status === "RUNNING" ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                      <tr className="text-left text-slate-600">
                        <th className="px-4 py-3 font-medium">Signe</th>
                        <th className="px-4 py-3 font-medium">Classes</th>
                        <th className="px-4 py-3 font-medium">Source</th>
                        <th className="px-4 py-3 font-medium">Statut</th>
                        <th className="px-4 py-3 font-medium">Score</th>
                        <th className="px-4 py-3 font-medium">Risque</th>
                      </tr>
                    </thead>
                    <tbody>
                      <SkeletonRow />
                      <SkeletonRow />
                      <SkeletonRow />
                    </tbody>
                  </table>
                </div>
              ) : (
                "Aucun résultat pour l’instant."
              )}
            </div>
          )}

          {/* Résumé global */}
          {result?.job?.resultJson && (
            <div className="rounded-lg border bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">Risque global :</span>
                <RiskBadge risk={result.job.resultJson.global_risk} />
              </div>
              {Array.isArray(result.job.resultJson.recommendations) &&
                result.job.resultJson.recommendations.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                    {result.job.resultJson.recommendations.map((rec: string, i: number) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                )}
            </div>
          )}

          {/* Debug JSON */}
          {result && (
            <details className="rounded-lg border bg-white p-4 shadow-sm">
              <summary className="cursor-pointer text-sm text-slate-600">
                Voir le JSON brut
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs ring-1 ring-inset ring-slate-200">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          )}
        </section>
      )}
    </main>
  );
}
