# Rise Content Flow

Multiagentowy workflow tworzenia treści dla klientów Rise360 — aplikacja webowa odtwarzająca
proces z arkusza „Tworzenie treści – multistep agentic flow".

**Stack:** Next.js (App Router, TypeScript) · Supabase (Postgres) · Tailwind CSS · Vercel

## Jak to działa

Hierarchia danych (jak w arkuszu):

1. **Klienci** — ustawienia klienta: `[TON_GŁOSU]`, `[BRANDBOOK]`, `[WYTYCZNE_OD_KLIENTA]`,
   `[KLIENT_BAZA_WIEDZY]`, `[KLIENT_DANE_1/2]`, dodatkowy JSON (każdy klucz staje się zmienną),
   integracja WordPress (publikacja draftów).
2. **Projekty** — w ramach klienta. Nowy projekt dostaje **domyślne prompty** (szablon
   `Sterowanie_copywriter_Wpip`: Deep Research → Graf wiedzy → Brief → Artykuł → EEAT →
   UX Writer → HTML). Każdy etap ma edytowalny prompt, model, temperature, top_k, top_p,
   thinking level, limit tokenów i flagę „publikuj jako draft WP". Etapy można dodawać,
   usuwać, wyłączać i zmieniać ich kolejność. W ustawieniach projektu definiujesz **zmienne
   zapytań** — te oznaczone jako wymagane są walidowane przy tworzeniu i uruchamianiu zapytania.
3. **Zapytania** (odpowiednik wierszy arkusza „Dane") — pojedyncze przebiegi workflow
   z wartościami zmiennych (`[SŁOWO_KLUCZOWE]`, `[JĘZYK]`, `[CEL_ARTYKUŁU]`, `[CTA]`,
   `[BAZA_WIEDZY]`, `[DANE_1]`, `[DANE_2]`, własne).
4. **Modele** — ustawienia aplikacji: nazwa, dostawca (Gemini / OpenAI / Anthropic /
   Perplexity / dowolny zgodny z OpenAI), ID modelu, klucz API, koszty za 1M tokenów.
   Każdy etap wybiera model z tej listy.

### Zmienne w promptach

W promptach używaj `[NAZWA_ZMIENNEJ]`. Dostępne są: pola klienta, zmienne zapytania oraz
`[OUTPUT_1]`…`[OUTPUT_N]` — wyniki wcześniejszych etapów (numeracja = pozycja etapu).

### Wykonywanie, stop i wznowienie

Każdy etap to **jedno wywołanie API** (`POST /api/jobs/:id/run-stage`) — dzięki temu
mieścimy się w limitach czasowych Vercela, a workflow można:

- **zatrzymać** (dokończy bieżący etap i stanie),
- **wznowić od ostatniego poprawnego etapu** (przycisk „Wznów"),
- **uruchomić od początku** (przycisk „Od początku" — czyści przebiegi).

Przeglądarka pełni rolę runnera — pętla po etapach działa, dopóki karta zapytania (lub
projektu przy uruchomieniu zbiorczym) jest otwarta. Po zamknięciu karty stan pozostaje
w bazie i można wznowić w dowolnym momencie.

Na stronie zapytania każdy etap pokazuje: **wysłany prompt po podstawieniu zmiennych,
pełny request do API, pełną odpowiedź API (raw JSON), wynik etapu, tokeny i koszt** —
w tym poprzednie próby. Błędy trafiają do zapytania oraz globalnego **dziennika logów**.

## Uruchomienie lokalne

```bash
npm install
cp .env.example .env.local   # uzupełnij SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_PASSWORD
npm run dev
```

## Konfiguracja Supabase

1. Utwórz projekt na [supabase.com](https://supabase.com).
2. Zastosuj migrację — dwie opcje:
   - **SQL Editor**: wklej zawartość `supabase/migrations/0001_init.sql` i uruchom, albo
   - **CLI**: `npx supabase link --project-ref <ref>` a potem `npx supabase db push`.
3. Skopiuj `Project URL` i `service_role` key (Settings → API) do zmiennych środowiskowych.

Migracja tworzy tabele (`clients`, `projects`, `stages`, `jobs`, `stage_runs`, `models`,
`logs`) i wypełnia listę modeli z arkusza „Modele" (bez kluczy API — uzupełnij w aplikacji).

## Deploy na Vercel

```bash
vercel link
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add APP_PASSWORD
vercel --prod
```

Uwaga: etapy typu deep research potrafią trwać kilka minut. Trasa `run-stage` deklaruje
`maxDuration = 800` — na planie Hobby limit funkcji to 300 s (z Fluid Compute), na Pro 800 s.
Jeśli etap przekracza limit planu, zostanie przerwany i oznaczony jako błąd — można go
wznowić lub użyć szybszego modelu.

## Bezpieczeństwo

- Dostęp do aplikacji chroni hasło `APP_PASSWORD` (cookie sesyjne HttpOnly).
- Baza jest dostępna wyłącznie z serwera przez klucz `service_role`; RLS jest włączony na
  wszystkich tabelach bez polityk, więc klucz `anon` nie ma dostępu do danych.
- Klucze API modeli są maskowane w API i UI (nigdy nie wracają do przeglądarki w całości).

## Niezaimplementowane elementy arkusza

- `SAVE_TO_DOCS` (zapis do Google Docs) — niepotrzebny: pełne wejścia/wyjścia każdego etapu
  są przechowywane w Postgresie bez limitu 50k znaków komórki.
- Szyfrowanie kluczy w arkuszu — zastąpione przechowywaniem po stronie serwera + maskowaniem.
