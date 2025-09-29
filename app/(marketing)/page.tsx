import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-8">
      <h1 className="text-3xl font-bold">Recherche d’antériorités de marque</h1>

      <p className="text-slate-600">
        MVP : saisissez un nom de marque, choisissez des classes de Nice, et lancez une recherche.
      </p>

      <SignedOut>
        <SignInButton mode="modal">
          <button className="rounded-lg border px-4 py-2">Se connecter</button>
        </SignInButton>
      </SignedOut>

      <SignedIn>
        <div className="flex items-center gap-4">
          <Link href="/app/dashboard" className="rounded-lg bg-black px-4 py-2 text-white">
            Ouvrir l’app
          </Link>
          <UserButton />
        </div>
      </SignedIn>
    </main>
  );
}
