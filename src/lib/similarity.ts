import { distance as levenshtein } from "fastest-levenshtein";
import { doubleMetaphone } from "double-metaphone";

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function jaroWinkler(a: string, b: string): number {
  // Sanitize
  const s1 = (a ?? "").toString();
  const s2 = (b ?? "").toString();
  if (!s1.length || !s2.length) return 0;

  function getMatches(s1: string, s2: string) {
    const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    const s1Matches = new Array(s1.length).fill(false);
    const s2Matches = new Array(s2.length).fill(false);
    let matches = 0;
    for (let i = 0; i < s1.length; i++) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance + 1, s2.length);
      for (let j = start; j < end; j++) {
        if (s2Matches[j]) continue;
        if (s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }
    let transpositions = 0;
    let k = 0;
    for (let i = 0; i < s1.length; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }
    return { matches, transpositions: transpositions / 2 };
  }

  const { matches, transpositions } = getMatches(s1, s2);
  if (!matches) return 0;
  const m = matches;
  const j = (m / s1.length + m / s2.length + (m - transpositions) / m) / 3;
  let p = 0;
  const l = Math.min(4, Math.min(s1.length, s2.length));
  for (; p < l && s1[p] === s2[p]; p++);
  return clamp01(j + p * 0.1 * (1 - j));
}

export function levenshteinSimilarity(a: string, b: string): number {
  const s1 = (a ?? "").toString();
  const s2 = (b ?? "").toString();
  if (!s1 && !s2) return 1;
  const d = levenshtein(s1.toLowerCase(), s2.toLowerCase());
  const maxLen = Math.max(s1.length, s2.length) || 1;
  return clamp01(1 - d / maxLen); // 0..1
}

// Alias attendu par l'API
export function levenshteinNorm(a: string, b: string): number {
  return levenshteinSimilarity(a, b);
}

export function metaphoneMatch(a: string, b: string): number {
  const [a1, a2] = doubleMetaphone(a ?? "");
  const [b1, b2] = doubleMetaphone(b ?? "");
  const setA = new Set([a1, a2].filter(Boolean));
  const setB = new Set([b1, b2].filter(Boolean));
  for (const x of setA) {
    if (setB.has(x)) return 1;
  }
  return 0; // binaire (MVP)
}

export function cosineSim(u: number[], v: number[]): number {
  if (!Array.isArray(u) || !Array.isArray(v)) return 0;
  const n = Math.min(u.length, v.length);
  let dot = 0, nu = 0, nv = 0;
  for (let i = 0; i < n; i++) {
    const x = u[i] ?? 0, y = v[i] ?? 0;
    dot += x * y; nu += x * x; nv += y * y;
  }
  return (nu && nv) ? dot / (Math.sqrt(nu) * Math.sqrt(nv)) : 0;
}

export function aggregateRiskScore(
  q: string, mark: string, opts?: { embeddingSim?: number }
): { score: number; parts: Record<string, number> } {
  const jw = jaroWinkler(q, mark);
  const lev = levenshteinNorm(q, mark);
  const ph = metaphoneMatch(q, mark);
  const sem = opts?.embeddingSim ?? 0;

  // pondérations MVP (ajuste plus tard)
  const score = 0.35 * jw + 0.35 * lev + 0.2 * ph + 0.1 * sem;
  return { score: clamp01(score), parts: { jw, lev, ph, sem } };
}

export function scoreToRiskLabel(score: number): "LOW" | "MEDIUM" | "HIGH" {
  if (score >= 0.8) return "HIGH";
  if (score >= 0.55) return "MEDIUM";
  return "LOW";
}