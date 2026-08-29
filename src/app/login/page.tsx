"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorBox, Input } from "@/components/ui";
import { api } from "@/lib/fetcher";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: { password } });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd logowania");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-lg font-bold">Rise Content Flow</h1>
        <p className="mb-4 text-sm text-zinc-500">Podaj hasło aplikacji, aby kontynuować.</p>
        <form onSubmit={submit} className="space-y-3">
          <Input
            type="password"
            placeholder="Hasło"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <ErrorBox message={error} />
          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? "Logowanie…" : "Zaloguj"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
