# COSMICLABS Make.fun Command Center

Pusat kendali **local-first, read-only, dan evidence-first** milik **COSMICLABS** (`@0xkeinara`) untuk menemukan kompetisi/bounty **make.fun**, mempelajari spesifikasi resmi tanpa modifikasi, menyusun analisis kompetitif dan enhancement prompt berbasis LLM nyata, mengarahkan skill agen (**Hermes**) secara optimal, memantau transkrip eksekusi, serta melacak submission dan reward.

---

## Fitur Utama

### 1. Multi-Bounty Discovery & Opportunity Intelligence
- Sinkronisasi read-only langsung ke endpoint resmi **make.fun** dengan pemisahan antara raw official snapshot (`bounty_snapshots`) dan data terstruktur (`bounties`).
- Indikator status sinkronisasi transparan: `LIVE`, `STALE`, `OFFLINE`, dan `UNVERIFIED`.
- Pencarian, filter status & kategori, watchlist, perbandingan peluang, serta sorting berdasarkan rasio **`$/Entry`** (pot USD per jumlah submission).
- Pemeriksa prasyarat kompetisi (**Prerequisite Checker**: software, akun, dan MCP yang dibutuhkan) serta **Leaderboard Gap Insights** (perbandingan peringkat #1, baseline `house`, dan posisi akun `@0xkeinara`).

### 2. AI Bounty Prompt Enhancer (4-Stage Workflow)
Bukan generator template statis — setiap klik **Enhance with AI** menjalankan pipeline 4 tahap di backend:
1. **Stage 1 — Official Context Verification**: Mengambil prompt resmi verbatim (atau manual override terverifikasi bila API tidak lengkap), aturan, deliverables, dan active gate checks.
2. **Stage 2 — Read-Only Research & Grounding**: Menjalankan Google Search Grounding (bila diaktifkan & tersedia) dengan fallback otomatis gratis ke GitHub Public Search API dan Wikipedia API + inspeksi manifest Competition Kit make.fun.
3. **Stage 3 — Category-Adapted Synthesis**: LLM menyusun strategi teknis/kreatif khusus kategori bounty, priority matrix berdasarkan kriteria penilaian, risiko, asumsi, instruksi Part 2 & Part 3, serta rekomendasi skill agen (**Agent Skill Stack**).
4. **Stage 4 — Compliance Verification & Master Markdown Assembly**: Memverifikasi kepatuhan aturan, menggabungkan skill resmi + AI-curated, dan menyusun Master Prompt 3 bagian siap salin ke Hermes.

### 3. Agent Skill Playbook (Prompt Studio)
- Menggabungkan skill/MCP resmi bounty (`official_mcp`, `official_bounty`), skill terkurasi AI (`ai_curated`), dan skill kustom Founder (`founder_custom`).
- Founder dapat mencentang/menghapus centang skill, menambahkan skill/tool Hermes manual beserta direktifnya, melihat pembaruan pratinjau Master Prompt secara real-time (`### Agent Skill & Tooling Directives` di dalam Part 2), dan menyimpan pilihan skill ke versi prompt SQLite.

### 4. Versi Prompt Append-Only & Line Diff
- Setiap penyimpanan membuat versi baru (`v1`, `v2`, dst.) di SQLite secara transaksional, lengkap dengan perbandingan line-by-line diff antar versi dan ekspor `.md`.

### 5. Hermes Transcript Pre-Check & Monitor
- Mengimpor log sesi/artefak Hermes secara read-only dari direktori yang diizinkan (`./evidence` secara default).
- Evaluasi **9-gate transcript pre-check** (`transcripts_present`, `thinking_wellformed`, `thinking_in_window`, `thinking_committed`, `thinking_reproduces`, `thinking_turns`, `thinking_priced`, `thinking_revised`, `thinking_fresh`) sebelum submission.

### 6. Submissions & Rewards Ledger
- Pencatatan submission terverifikasi beserta commit SHA, tautan repositori, skor, dan peringkat.
- Ledger reward terpisah antara nilai yang diumumkan (`announcedPrizeUsd`), award terverifikasi (`verifiedAwardUsd`), dan dana yang benar-benar diterima (`receivedUsd`).

---

## Modul Dashboard (8 Views)

1. **Overview** — Ringkasan metrik operasional, status LLM & sinkronisasi, serta watchlist aktif.
2. **Bounty Explorer** — Penjelajah kompetisi make.fun dengan filter, rasio `$/Entry`, prasyarat, dan leaderboard insights.
3. **AI Prompt Enhancer** (`PromptStudioView`) — Workspace 4 panel: Official Requirements, AI Analysis & Research, Enhanced Prompt Editor + Agent Skill Playbook, dan Final Master Prompt Preview/Diff.
4. **Prompt Library** — Indeks seluruh draft dan riwayat versi prompt tersimpan.
5. **Hermes Monitor** — Import/scan bukti sesi read-only dan pengecekan 9-gate transcript compliance.
6. **Submissions** — Pelacak status entri dan peringkat kompetisi.
7. **Rewards Analytics** — Grafik dan ledger pemantauan prize pool vs klaim aktual.
8. **Settings** — Konfigurasi provider LLM (Gemini free-tier / paid-tier berizin eksplisit, atau endpoint OpenAI-compatible lokal), Google Search grounding, handle akun, interval sync, path evidence, dan test koneksi LLM.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Recharts
- **Backend Server**: Express (`tsx server.ts`) terintegrasi dengan Vite middleware di development
- **Database & ORM**: SQLite (`better-sqlite3`) + Drizzle ORM (`drizzle-orm` / `drizzle-kit`)
- **LLM SDK**: `@google/genai` (server-side) & OpenAI-compatible HTTP client
- **Validasi**: Zod

---

## Struktur Proyek

```text
.
├── server.ts                       # Express API server & Vite SPA mounting (port 3000)
├── drizzle.config.ts               # Konfigurasi Drizzle Kit untuk SQLite
├── server/
│   ├── schema.ts                   # Definisi 9 tabel & relasi Drizzle ORM
│   ├── db.ts                       # Koneksi SQLite, inisialisasi DDL/migrasi, mapper record
│   ├── crud.ts                     # Lapisan CRUD transaksional & query command center
│   ├── makefun.ts                  # Integrasi read-only API make.fun & leaderboard insights
│   ├── llm.ts                      # Workflow 4-stage AI Enhancer & cek koneksi LLM
│   └── transcript-gate.ts          # Evaluator 9-gate transcript compliance Hermes
├── src/
│   ├── App.tsx                     # Layout utama, navigasi sidebar & state global
│   ├── lib/
│   │   ├── prompt-builder.ts       # Ekstraksi/merge skill & assembler Master Markdown
│   │   └── utils.ts                # Formatter mata uang/tanggal, diff, ekspor Markdown
│   ├── types/
│   │   └── command-center.ts       # Tipe TypeScript bersama frontend & backend
│   └── components/
│       ├── ui/primitives.tsx       # Komponen UI dashboard dark-mode
│       └── views/                  # 8 halaman modul Command Center
└── tests/
    ├── command-center.test.ts      # Unit test utilitas, skill builder, gate & insights
    └── crud.test.ts                # Unit test terisolasi Drizzle CRUD di SQLite :memory:
```

---

## Skema Database SQLite (9 Tabel)

Database tersimpan lokal di `./data/cosmiclabs.db` dan otomatis diinisialisasi saat server dijalankan:

- `bounties` — Metadata kompetisi, pot reward, prasyarat, watchlist, dan catatan Founder.
- `bounty_snapshots` — Snapshot mentah resmi make.fun (`raw_competition_json`, `raw_requirements_json`, `raw_leaderboard_json`, `raw_kit_json`) + `manual_prompt_override`.
- `ai_analyses` — Hasil analisis 4 tahap LLM, referensi riset, priority matrix, dan `recommended_skills_json`.
- `prompt_drafts` — Metadata draft prompt per bounty dan referensi ke versi terbaru.
- `prompt_versions` — Riwayat versi prompt append-only termasuk `selected_skills_json` dan `full_markdown`.
- `hermes_evidence` — Arsip read-only log sesi dan artefak Hermes.
- `submissions` — Catatan entri submission dan peringkat.
- `rewards` — Ledger reward dan status klaim.
- `app_settings` — Konfigurasi provider LLM, model, handle akun, dan cursor sinkronisasi.

---

## Konfigurasi Environment

Salin `.env.example` atau atur environment variable pada runtime/Secrets:

```env
# Wajib jika menggunakan provider Google Gemini (dikelola di server-side)
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"

# Opsional jika menggunakan endpoint OpenAI-compatible lokal/eksternal yang memerlukan Bearer token
OPENAI_COMPAT_API_KEY=""

# Opsional (default: 3000)
PORT=3000
```

> **Catatan Keamanan & Biaya**: API key hanya dibaca di sisi server (`server/llm.ts`). Model Gemini berbayar (`gemini-4-argon`, `gemini-4-carbon`) diblokir secara default hingga Founder mengaktifkan otorisasi eksplisit di halaman **Settings**. Model free-tier default adalah `gemini-4-hydrogen` dan `gemini-3.1-flash-lite`.

---

## Menjalankan Secara Lokal

### 1. Instalasi Dependensi
```bash
npm install
```

### 2. Menjalankan Development Server (Port 3000)
```bash
npm run dev
```
Aplikasi tersedia di `http://localhost:3000`.

### 3. Typecheck, Build Produksi, dan Unit Test
```bash
# TypeScript check
npm run lint

# Build frontend produksi (Vite)
npm run build

# Jalankan unit test (skill builder, transcript gate, dan Drizzle CRUD)
npx tsx --test tests/command-center.test.ts tests/crud.test.ts
```

### 4. Menjalankan Mode Produksi
```bash
NODE_ENV=production npm start
```

---

## Prinsip Keamanan & Operasional

- **Read-Only ke make.fun**: Aplikasi tidak pernah melakukan login otomatis, registrasi kompetisi, pengiriman submission, transaksi wallet, atau eksekusi prompt ke repository target.
- **Tanpa Output AI Palsu**: Jika kredensial LLM tidak tersedia atau kuota habis, sistem menampilkan pesan error yang jelas tanpa menggantinya dengan template statis.
- **Preservasi Prompt Resmi**: Teks **PART 1 — ORIGINAL MAKE.FUN PROMPT** selalu dipertahankan apa adanya dan aturan resmi kompetisi tetap menjadi prioritas utama dibanding instruksi enhancement.
