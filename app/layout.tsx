// app/layout.tsx
import { ClerkProvider } from "@clerk/nextjs";

export const metadata = {
  title: "SaaS Marques",
  description: "Recherche d'antériorité de marques",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh bg-white text-slate-900">
        <ClerkProvider>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}