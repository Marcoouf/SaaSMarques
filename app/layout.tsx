import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="fr">
        <body className="min-h-dvh bg-white text-slate-900">{children}</body>
      </html>
    </ClerkProvider>
  );
}
