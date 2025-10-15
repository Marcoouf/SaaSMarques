// src/lib/connectors/euipo.ts
/**
 * EUIPO Trademark Search connector (Sandbox/Prod via EUIPO API Portal)
 * - Auth: IBM API Gateway headers (X-IBM-Client-Id / X-IBM-Client-Secret)
 * - Endpoints (d'après la doc du portail): GET /trademarks, GET /trademarks/{applicationNumber}
 *
 * NB: Sans identifiants EUIPO valides, le connecteur renvoie [] (pour ne pas casser le MVP).
 * IMPORTANT: La base ne doit PAS contenir de segment de version (pas de /1.0.0).
 */

type Env = {
  EUIPO_ENABLED?: string;
  EUIPO_API_BASE?: string;         // ex: https://api.dev.euipo.europa.eu/trademark-search  (sans /1.0.0)
  EUIPO_PRODUCT_KEY?: string;      // depuis "Subscriptions" (pas OAuth)
  EUIPO_PRODUCT_SECRET?: string;   // depuis "Subscriptions" (pas OAuth)
  EUIPO_MOCK?: string;
};

const E = process.env as Env;
const EUIPO_MOCK = E.EUIPO_MOCK === "true";

// ------- Types normalisés vers le pipeline du MVP -------
export type EuipoHit = {
  source: "EUIPO";
  sourceId: string;         // applicationNumber
  sign: string;             // libellé du signe
  niceClasses: number[];    // classes de Nice
  status: string;           // statut normalisé (REGISTERED/PENDING/OPPOSED/REJECTED/WITHDRAWN/EXPIRED/DEAD/UNKNOWN)
  filingDate?: string | null;
  holder?: string | null;
  imageUrl?: string | null;
};

// Ré-utilise le même RawHit que le reste du pipeline (alias compatible)
export type RawHit = EuipoHit;

// ------- Base sans version (on supprime /1.0.0 etc.) -------
const RAW_BASE = (E.EUIPO_API_BASE ?? "https://api.euipo.europa.eu/trademark-search").replace(/\/+$/, "");
const EUIPO_BASE = RAW_BASE.replace(/\/\d+(?:\.\d+){0,2}$/, ""); // retire /1 ou /1.0 ou /1.0.0 en fin d'URL

// Alerte si on a dû normaliser (utile en dev)
if (RAW_BASE !== EUIPO_BASE) {
  console.warn(`[EUIPO] La base fournie contient un segment de version et a été normalisée: "${RAW_BASE}" -> "${EUIPO_BASE}"`);
}

// ------- Mock (dev) -------
function mockHits(term: string, classes: (string | number)[] = [], limit = 10): EuipoHit[] {
  const normClasses = Array.from(
    new Set(
      classes
        .map((c) => Number(String(c).replace(/\D+/g, "")))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );
  const base: EuipoHit[] = [
    {
      source: "EUIPO",
      sourceId: "EUTM-0001",
      sign: term,
      niceClasses: normClasses.length ? normClasses : [1, 35],
      status: "PENDING",
      filingDate: "2024-05-15",
      holder: "ACME SARL",
      imageUrl: null,
    },
    {
      source: "EUIPO",
      sourceId: "EUTM-0002",
      sign: `${term}-X`,
      niceClasses: normClasses.length ? normClasses : [9, 42],
      status: "REGISTERED",
      filingDate: "2023-12-02",
      holder: "Globex BV",
      imageUrl: null,
    },
  ];
  return base.slice(0, Math.max(1, Math.min(limit, base.length)));
}

// ------- Statut -> normalisation simple -------
function normalizeStatus(raw?: string): string {
  const s = (raw ?? "").toLowerCase();

  if (!s) return "UNKNOWN";
  if (s.includes("registered") || s.includes("registered/renewed") || s.includes("granted"))
    return "REGISTERED";
  if (s.includes("application") || s.includes("examination") || s.includes("published"))
    return "PENDING";
  if (s.includes("opposition") || s.includes("opposed"))
    return "OPPOSED";
  if (s.includes("refused") || s.includes("rejected"))
    return "REJECTED";
  if (s.includes("withdrawn"))
    return "WITHDRAWN";
  if (s.includes("expired"))
    return "EXPIRED";
  if (s.includes("cancelled") || s.includes("invalidated") || s.includes("lapsed"))
    return "DEAD";

  return "UNKNOWN";
}

// ------- Mapping JSON EUIPO -> Hit normalisé -------
function mapRecordToHit(rec: any): EuipoHit | null {
  if (!rec) return null;

  // Les noms de champs ci-dessous sont *prévisibles* mais peuvent varier légèrement suivant la version.
  // Ajuste après avoir vu la vraie payload EUIPO.
  const applicationNumber =
    rec.applicationNumber ?? rec.appNumber ?? rec.application?.number ?? null;
  const sign =
    rec.name ?? rec.markName ?? rec.trademarkName ?? rec.word ?? "";
  const classesArr: number[] = Array.from(
    new Set(
      (rec.niceClasses ??
        rec.classes ??
        rec.classifications ??
        [])
        .map((x: any) => Number(String(x).replace(/\D+/g, "")))
        .filter((n: number) => Number.isFinite(n) && n > 0)
    )
  );

  const statusRaw =
    rec.status ??
    rec.currentStatus ??
    rec.applicationStatus ??
    rec.registrationStatus ??
    "";
  const status = normalizeStatus(statusRaw);

  const holder =
    rec.ownerName ??
    rec.holder?.name ??
    (Array.isArray(rec.owners) ? rec.owners[0]?.name : null) ??
    null;

  const filingDate =
    rec.applicationDate ?? rec.filingDate ?? rec.dates?.filing ?? null;

  // Image: endpoint /trademarks/{applicationNumber}/image (selon doc produit)
  const imageUrl = applicationNumber
    ? `${EUIPO_BASE}/trademarks/${encodeURIComponent(applicationNumber)}/image`
    : null;

  if (!applicationNumber || !sign) return null;

  return {
    source: "EUIPO",
    sourceId: String(applicationNumber),
    sign: String(sign),
    niceClasses: classesArr,
    status,
    filingDate: filingDate ? String(filingDate) : null,
    holder,
    imageUrl,
  };
}

// ------- Recherche principale -------
// Utilise IBM API Gateway headers, pas OAuth.
export async function searchEUIPO(
  term: string,
  classes: (string | number)[] = [],
  limit: number = 25
): Promise<EuipoHit[]> {
  if (EUIPO_MOCK) {
    return mockHits(term, classes, limit);
  }

  // Désactivé / non configuré → renvoie [] proprement
  if (String(E.EUIPO_ENABLED).toLowerCase() === "false") return [];
  if (!E.EUIPO_PRODUCT_KEY || !E.EUIPO_PRODUCT_SECRET) {
    console.warn("[EUIPO] Missing product key/secret -> returning []");
    return [];
  }

  const size = Math.max(1, Math.min(limit, 100));

  const normalizedClasses = classes
    .map((c) => String(c).replace(/\D+/g, ""))
    .filter(Boolean)
    .join(",");

  // Prépare plusieurs variantes d'URL selon les plans EUIPO
  const urls: string[] = [];

  // 1) /trademarks?q=TERM
  {
    const p = new URLSearchParams();
    p.set("q", term);
    if (normalizedClasses) p.set("niceClasses", normalizedClasses);
    p.set("size", String(size));
    p.set("offset", "0");
    urls.push(`${EUIPO_BASE}/trademarks?${p.toString()}`);
  }
  // 2) /trademarks?name=TERM
  {
    const p = new URLSearchParams();
    p.set("name", term);
    if (normalizedClasses) p.set("niceClasses", normalizedClasses);
    p.set("size", String(size));
    p.set("offset", "0");
    urls.push(`${EUIPO_BASE}/trademarks?${p.toString()}`);
  }
  // 3) /trademarks/search?q=TERM
  {
    const p = new URLSearchParams();
    p.set("q", term);
    if (normalizedClasses) p.set("niceClasses", normalizedClasses);
    p.set("size", String(size));
    p.set("offset", "0");
    urls.push(`${EUIPO_BASE}/trademarks/search?${p.toString()}`);
  }

  const commonHeaders = {
    Accept: "application/json",
    "X-IBM-Client-Id": E.EUIPO_PRODUCT_KEY,
    "X-IBM-Client-Secret": E.EUIPO_PRODUCT_SECRET,
    "User-Agent": "SaaSMarques/0.1 (+https://example.com)",
  } as const;

  let firstPayload: any = null;

  for (const url of urls) {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 12_000);
    let r: Response;
    try {
      r = await fetch(url, { headers: commonHeaders, cache: "no-store", redirect: "manual", signal: ac.signal });
    } catch {
      clearTimeout(timeout);
      continue;
    }
    clearTimeout(timeout);

    // Si on tombe encore sur un redirect HTML, la base est probablement erronée (portail Drupal)
    const ct = r.headers.get("content-type") || "";
    if ((r.status >= 300 && r.status < 400) || ct.includes("text/html")) {
      console.warn("[EUIPO] Redirect/HTML reçu — vérifie EUIPO_API_BASE (ne pas utiliser les pages portail).", r.status, ct);
      continue;
    }
    if (!r.ok) {
      // Essaie l'URL suivante si celle-ci n'est pas supportée
      continue;
    }

    const data: any = await r.json().catch(() => null);
    if (firstPayload == null) firstPayload = data;

    const list: any[] =
      data?.items ??
      data?.trademarks ??
      data?.results ??
      (Array.isArray(data) ? data : []) ??
      [];

    const hits: EuipoHit[] = [];
    for (const rec of list) {
      const h = mapRecordToHit(rec);
      if (h) hits.push(h);
    }
    if (hits.length) return hits;
  }

  if (firstPayload) {
    console.warn("EUIPO search: réponse sans liste reconnue (items/trademarks/results). Vérifie la doc du plan.");
  }
  return [];
}