import { prisma } from "@/lib/db";
import { clerkClient } from "@clerk/nextjs/server";

/**
 * Garantit qu'un User existe pour un clerkId donné et renvoie
 * l'enregistrement User (avec le 'id' réel).
 *
 * - upsert sur clerkId (unique) -> pas de P2002
 * - si un User existe déjà avec ce clerkId mais un 'id' différent,
 *   on réutilise cet enregistrement et on renvoie son 'id'.
 */
export async function ensureUserRecord(clerkId: string) {
  // Tente de récupérer des infos publiques chez Clerk (optionnel)
  let email: string | null = null;
  let name: string | null = null;
  try {
    const cc = await clerkClient(); // v6: c’est une fonction asynchrone
    const u = await cc.users.getUser(clerkId);
    email = u?.primaryEmailAddress?.emailAddress ?? null;
    name = [u?.firstName, u?.lastName].filter(Boolean).join(" ") || null;
  } catch {
    // Non bloquant (dev/offline) : on mettra des fallbacks
  }

  // IMPORTANT : upsert sur clerkId (unique)
  const user = await prisma.user.upsert({
    where: { clerkId }, // nécessite @unique sur clerkId dans ton schema Prisma
    update: {
      // On peut rafraîchir quelques champs non-critiques
      email: email ?? undefined,
      name: name ?? undefined,
    },
    create: {
      id: clerkId,          // pour les nouveaux, on aligne id = clerkId (simple)
      clerkId,              // unique
      email: email ?? `user:${clerkId}`, // fallback pour éviter TS/DB non-null
      name: name ?? "",
    },
  });

  return user; // contient 'id' (peut ≠ clerkId si ancien enregistrement)
}
