// src/lib/connectors/inpi.ts

export type InpiHit = {
  sign: string;
  niceClasses: number[];
  sourceId: string | null;       // ApplicationNumber
  status: string | null;         // MarkCurrentStatusCode
  holder: string | null;         // DEPOSANT
  source: "INPI";
};

// Utilitaire : fabrique la requête Solr-like de l’INPI
function buildQuery(mark: string, classes: number[]): string {
  // Doc : exemple de requête "[Mark=Jouve]". On étend en AND/OR sur CLASSIFICATION.  [oai_citation:2‡API INPI.pdf](file-service://file-NwKmEnNXZw1YiDjnMVAhwv)
  const safe = mark.replace(/[\[\]="]/g, " ").trim();
  const qMark = `[Mark=${safe}]`;
  const qClasses =
    classes && classes.length
      ? ` AND (${classes.map((c) => `[CLASSIFICATION=${c}]`).join(" OR ")})`
      : "";
  return qMark + qClasses;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (process.env.INPI_BEARER) {
    headers.Authorization = `Bearer ${process.env.INPI_BEARER}`;
  } else if (process.env.INPI_API_KEY) {
    headers["X-API-KEY"] = process.env.INPI_API_KEY!;
    headers.apikey = process.env.INPI_API_KEY!;
  }
  return headers;
}

// Parse une éventuelle réponse JSON de l'API (tolérant au schéma)
function parseResultsJSON(json: any): InpiHit[] {
  const toArray = (v: any) => (Array.isArray(v) ? v : v ? [v] : []);

  // Tentatives de chemins communs observés/attendus
  const results =
    json?.trademarkSearch?.Results?.resultTrademark ??
    json?.trademarkSearch?.results?.resultTrademark ??
    json?.results?.resultTrademark ??
    json?.results ??
    [];

  return toArray(results).map((r: any) => {
    const fieldsObj = r?.Fields ?? r?.fields ?? null;
    const readField = (name: string): string | null => {
      if (!fieldsObj) return null;
      if (typeof fieldsObj[name] === "string") return fieldsObj[name];
      const list = toArray(fieldsObj.Field);
      const hit = list.find((f: any) => {
        const n = f?.name ?? f?.Name ?? f?.fieldName;
        return (n || "").toUpperCase() === name.toUpperCase();
      });
      if (hit?.value) {
        if (Array.isArray(hit.value)) return String(hit.value[0]);
        return String(hit.value);
      }
      if (hit && typeof hit[name] === "string") return hit[name];
      return null;
    };

    const mark =
      r?.Mark ??
      r?.mark ??
      readField("Mark") ??
      readField("MARK") ??
      null;

    const appNum =
      r?.ApplicationNumber ??
      r?.applicationNumber ??
      readField("ApplicationNumber") ??
      readField("APPLICATIONNUMBER") ??
      null;

    const status =
      r?.MarkCurrentStatusCode ??
      r?.markCurrentStatusCode ??
      readField("MarkCurrentStatusCode") ??
      readField("MARKCURRENTSTATUSCODE") ??
      null;

    const holder =
      r?.DEPOSANT ??
      r?.deposant ??
      readField("DEPOSANT") ??
      readField("APPLICANT") ??
      null;

    let classes: number[] = [];
    const classStr =
      r?.CLASSIFICATION ??
      readField("CLASSIFICATION") ??
      readField("Class") ??
      null;
    if (classStr) {
      classes = String(classStr)
        .split(/[,\s;]+/)
        .map((x) => parseInt(x, 10))
        .filter((n) => Number.isFinite(n));
    } else {
      const clsArr = toArray(r?.Class ?? r?.class ?? []);
      classes = clsArr
        .map((c: any) => parseInt(String(c).trim(), 10))
        .filter((n: number) => Number.isFinite(n));
    }

    return {
      sign: mark ?? "",
      niceClasses: classes,
      sourceId: appNum,
      status: status,
      holder: holder,
      source: "INPI",
    } as InpiHit;
  });
}

export async function searchINPI(
  mark: string,
  classes: number[] = [],
  limit = 50,
  collections: ("FR" | "EU" | "WO")[] = ["FR"]
): Promise<InpiHit[]> {
  // Mode mock pour le dev local sans quota
  if (process.env.INPI_MOCK === "true") {
    return [
      {
        sign: `${mark}A`,
        niceClasses: classes.length ? classes : [35],
        sourceId: "FR-2024-000001",
        status: "REGISTERED",
        holder: "Société Demo",
        source: "INPI",
      },
    ];
  }

  const base = process.env.INPI_BASE?.replace(/\/+$/, "");
  if (!base) throw new Error("INPI_BASE manquant dans l'environnement");

  const url = `${base}/api/marques/search`;
  const body = {
    collections,
    fields: [
      "ApplicationNumber",
      "Mark",
      "MarkCurrentStatusCode",
      "DEPOSANT",
      "CLASSIFICATION",
    ],
    position: 0,
    size: Math.min(limit, 100),
    query: buildQuery(mark, classes),
    sortList: ["APPLICATION_DATE DESC", "MARK ASC"],
  };

  // Timeout via AbortController (20s)
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 20_000);

  const headers = authHeaders();
  const debug = process.env.INPI_DEBUG === "true";
  if (debug) {
    console.log("[INPI] request", { url, headers: { ...headers, apikey: headers.apikey ? "***" : undefined, "X-API-KEY": headers["X-API-KEY"] ? "***" : undefined }, body });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(to);
  }

  const ct = res.headers.get("content-type")?.toLowerCase() || "";
  const raw = await res.text();

  if (debug) {
    console.log("[INPI] response", { status: res.status, ct, preview: raw.slice(0, 400) });
  }

  if (!res.ok) {
    throw new Error(`INPI ${res.status} ${res.statusText} – payload: ${raw.slice(0, 500)}`);
  }

  try {
    // On force JSON côté Accept, mais on sécurise en testant quand même.
    const looksJson = raw.trim().startsWith("{") || raw.trim().startsWith("[");
    if (!looksJson) {
      console.warn("[INPI] non-JSON payload received (content-type:", ct, ") → []");
      return [];
    }
    const json = JSON.parse(raw);
    return parseResultsJSON(json).filter((h) => (h.sign || "").trim().length > 0);
  } catch (e) {
    console.warn("INPI parse error:", e);
    return [];
  }
}