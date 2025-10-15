// src/lib/status.ts
export type NormalizedStatus =
  | "REGISTERED" | "PENDING" | "REJECTED" | "OPPOSED"
  | "EXPIRED" | "WITHDRAWN" | "CANCELLED" | "UNKNOWN";

export function normalizeStatus(raw?: string): NormalizedStatus {
  const s = (raw || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (/oppose/.test(s)) return "OPPOSED";
  if (/enregistr|regist/.test(s)) return "REGISTERED";
  if (/(attente|instance|pending|exam)/.test(s)) return "PENDING";
  if (/(rejet|refus|reject)/.test(s)) return "REJECTED";
  if (/(retrait|withdraw)/.test(s)) return "WITHDRAWN";
  if (/(expir|lapse)/.test(s)) return "EXPIRED";
  if (/(annul|cancel)/.test(s)) return "CANCELLED";
  return "UNKNOWN";
}