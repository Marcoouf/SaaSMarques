// middleware.ts (RACINE DU PROJET)
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/api/stripe/checkout",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;         // routes publiques => OK
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn(); // protection manuelle
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],   // protège tout sauf assets/_next
};
