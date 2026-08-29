import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";

// Always evaluate the auth cookie at request time (never prerender behind the gate)
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthenticated())) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <Link href="/" className="text-sm font-bold tracking-tight">
            Rise <span className="text-indigo-600">Content Flow</span>
          </Link>
          <div className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-300">
            <Link href="/" className="hover:text-indigo-600">Klienci</Link>
            <Link href="/settings/models" className="hover:text-indigo-600">Modele</Link>
            <Link href="/logs" className="hover:text-indigo-600">Logi</Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
