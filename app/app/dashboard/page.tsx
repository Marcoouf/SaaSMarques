"use client";

import { useState } from "react";

export default function Dashboard() {
  const [queryText, setQueryText] = useState("");
  const [classes, setClasses] = useState<string>("");
  const [territory, setTerritory] = useState<"FR" | "EU">("FR");
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  async function createJob() {
    const niceClasses = classes.split(",").map((s) => Number(s.trim())).filter(Boolean);
    const r = await fetch("/api/search/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queryText, niceClasses, territory }),
    }).then((x) => x.json());

    if (r.ok) setJobId(r.jobId);
    else alert(r.error ?? "Erreur");
  }

  async function refresh() {
    if (!jobId) return;
    const r = await fetch(`/api/search/jobs/${jobId}`).then((x) => x.json());
    setResult(r);
  }

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      <h2 className="text-2xl font-semibold">Nouvelle recherche</h2>

      <div className="space-y-3">
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="Nom de marque (ex: MERÉA)"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
        />
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="Classes Nice (ex: 9,35)"
          value={classes}
          onChange={(e) => setClasses(e.target.value)}
        />
        <select
          className="w-full rounded border px-3 py-2"
          value={territory}
          onChange={(e) => setTerritory(e.target.value as any)}
        >
          <option value="FR">France (INPI)</option>
          <option value="EU">Union européenne (EUIPO)</option>
        </select>

        <button onClick={createJob} className="rounded bg-black px-4 py-2 text-white">
          Lancer la recherche (MVP)
        </button>
      </div>

      {jobId && (
        <div className="rounded border p-4">
          <div className="mb-2 text-sm text-slate-600">Job ID : {jobId}</div>
          <button onClick={refresh} className="rounded border px-3 py-1">
            Rafraîchir le statut
          </button>

          {result && (
            <pre className="mt-4 whitespace-pre-wrap text-sm">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </main>
  );
}
