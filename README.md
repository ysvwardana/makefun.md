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
2. **Stage 2 — Read-Only Research**: Menggunakan GitHub Public Search API dan Wikipedia API serta memeriksa manifest Competition Kit make.fun.
3. **Stage 3 — Category-Adapted Synthesis**: LLM menyusun strategi teknis/kreatif khusus kategori bounty, priority matrix berdasarkan kriteria penilaian, risiko, asumsi, instruksi Part 2 & Part 3, serta rekomendasi skill agen (**Agent Skill Stack**).
4. **Stage 4 — Gate Coverage & Master Markdown Assembly**: Mencocokkan rencana verifikasi dari model dengan seluruh gate aktif, menandai gate yang belum tercakup (bukan mengklaim compliance pass), dan menyusun Master Prompt 3 bagian untuk ditinjau lalu disalin pengguna ke Hermes.

Alur: Sync bounty → pilih bounty → refresh prompt standar dan requirements → Enhance with AI → tinjau strategi, provenance, dan gate → Copy Master Prompt. Aplikasi tidak menjalankan Hermes atau melakukan submission.

- Part 1 berasal dari field prompt khusus atau elemen unik `p.crawl-body-prompt` pada halaman bounty resmi. Teks terdekode disimpan persis, termasuk CR/LF, karakter, dan whitespace awal/akhir. Brief, judul, rules, dan deliverables adalah konteks terpisah. Jika sumber persis tidak tersedia, pengguna harus menempelkan prompt dan sumber ditandai manual.
- Setiap enhancement me-refresh detail dan requirements. Kegagalan bagian sumber ditampilkan; cache hanya dapat dipakai setelah pilihan eksplisit dan ditandai beserta waktu pengambilannya. Snapshot lama tidak ditimpa.
- Analisis menyimpan ID/hash snapshot, hash rules, hash tepat dua message yang dikirim, waktu, provider/model, dan coverage seluruh gate. Batas konteks menolak request dengan rincian bagian, bukan memotong rules atau check diam-diam.
- Part 1 saat Save berasal dari snapshot server. ID analisis, snapshot, dan slug divalidasi bersama. Perubahan aturan memerlukan acknowledgment sebelum reuse. Versi lama tanpa bukti provenance tetap tersedia sebagai `legacy_unverified`.
- Interval sinkronisasi di Settings menjalankan sync berkala dengan satu run aktif, di samping tombol manual. Status keberhasilan/kegagalan terlihat dan daftar Prompt Studio diperbarui tanpa restart.

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
8. **Settings** — Konfigurasi model OpenAI-compatible, handle akun, interval sync, path evidence, dan tes koneksi LLM. URL endpoint dan API key diatur melalui environment server.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Recharts
- **Backend Server**: Express (`tsx server.ts`) terintegrasi dengan Vite middleware di development
- **Database & ORM**: SQLite (`better-sqlite3`) + Drizzle ORM (`drizzle-orm` / `drizzle-kit`)
- **LLM**: OpenAI-compatible HTTP client di server, dengan deadline, pembatasan ukuran respons, concurrency, dan rate limit
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

Salin `.env.example` ke `.env` atau atur environment variable pada runtime server. Restart server setelah mengubah konfigurasi:

```env
HOST=127.0.0.1
PORT=3000
OPENAI_COMPAT_API_KEY=""
OPENAI_COMPAT_BASE_URL="http://localhost:11434/v1"
LLM_ALLOW_PAID_REQUESTS=false
LLM_REQUEST_TIMEOUT_MS=60000
LLM_MAX_RESPONSE_BYTES=1048576
LLM_MAX_CONCURRENT_REQUESTS=2
LLM_MAX_REQUESTS_PER_MINUTE=10
```

| Variable | Fungsi |
| --- | --- |
| `HOST` | Default `127.0.0.1`. Hanya `127.0.0.1`, `::1`, dan `localhost` diterima; bind ke jaringan remote belum didukung. |
| `PORT` | Port HTTP lokal, default `3000`, bilangan bulat 1–65535. |
| `OPENAI_COMPAT_API_KEY` | Bearer token server untuk endpoint kompatibel bila diperlukan; Ollama lokal biasanya tidak memerlukan key. |
| `OPENAI_COMPAT_BASE_URL` | Satu endpoint yang disetujui server, default `http://localhost:11434/v1`. Hanya HTTP(S), tanpa username/password, query, atau fragment. Settings menampilkan URL efektif ini secara read-only; nilai lama di SQLite tidak menentukan tujuan request. |
| `LLM_ALLOW_PAID_REQUESTS` | Tetapkan `true` untuk mengizinkan request ke endpoint HTTPS publik yang ditetapkan server. Default `false` membatasi request LLM ke endpoint loopback. |
| `LLM_REQUEST_TIMEOUT_MS` | Batas waktu request LLM dalam milidetik. |
| `LLM_MAX_RESPONSE_BYTES` | Batas ukuran respons provider dalam byte. |
| `LLM_MAX_CONCURRENT_REQUESTS` | Batas request LLM aktif bersamaan. |
| `LLM_MAX_REQUESTS_PER_MINUTE` | Batas request LLM per menit untuk proses server ini. |
| `LLM_MAX_CONTEXT_CHARS` | Batas karakter dua message lengkap yang akan dikirim, default 400000. Request yang terlalu besar ditolak dengan rincian bagian dan gate. |
| `LLM_MAX_COMPLETION_TOKENS` | Opsional, batas output model melalui `max_tokens`; sesuaikan dukungan provider. |

**Keamanan & biaya:** API key hanya dibaca di server; jangan masukkan secret dalam textbox UI atau URL endpoint dan jangan commit `.env`. Halaman Settings bukan penyimpanan secret. Biaya dan kuota untuk enhancement dan tes koneksi mengikuti model serta akun provider. Verifikasi harga dan kuota dengan provider sebelum request. Pembatasan proses juga berlaku untuk test koneksi.

API lokal memeriksa `Host` loopback untuk mencegah DNS rebinding dan menolak `Origin` asing. Request browser harus berasal dari origin HTTP yang sama persis; request CLI tanpa `Origin` diperbolehkan. Body pada metode POST/PATCH/PUT/DELETE harus `Content-Type: application/json`; aksi tanpa body tetap didukung. Jangan publikasikan aplikasi melalui tunnel atau reverse proxy: autentikasi akses remote belum tersedia.

---

## Menjalankan Secara Lokal

> **Package Manager:** Proyek ini menggunakan **Bun** (`bun.lock`). Jangan gunakan `npm install` karena dapat gagal dengan konflik peer dependency (`ERESOLVE vite` vs `esbuild`).

### 1. Instalasi Dependensi
```bash
bun install
```

### 2. Menjalankan Development Server (Port 3000)
```bash
bun run dev
```
Aplikasi tersedia di `http://127.0.0.1:3000` secara default. Jika memakai `HOST=::1`, buka `http://[::1]:3000`.

### 3. Typecheck, Build Produksi, dan Unit Test
```bash
# TypeScript check
bun run lint

# Build frontend produksi (Vite)
bun run build

# Jalankan unit test (skill builder, transcript gate, dan Drizzle CRUD)
# Isolasi database default saat semua test berjalan paralel.
# PowerShell: $env:COSMICLABS_DB_PATH=':memory:'
COSMICLABS_DB_PATH=:memory: bun x tsx --test tests/*.test.ts
```

### 4. Menjalankan Mode Produksi
```bash
NODE_ENV=production bun run start
```

---

## Prinsip Keamanan & Operasional

- **Read-Only ke make.fun**: Aplikasi tidak pernah melakukan login otomatis, registrasi kompetisi, pengiriman submission, transaksi wallet, atau eksekusi prompt ke repository target.
- **Tanpa Output AI Palsu**: Jika kredensial LLM tidak tersedia atau kuota habis, sistem menampilkan pesan error yang jelas tanpa menggantinya dengan template statis.
- **Preservasi Prompt Resmi**: Teks **PART 1 — ORIGINAL MAKE.FUN PROMPT** selalu dipertahankan apa adanya dan aturan resmi kompetisi tetap menjadi prioritas utama dibanding instruksi enhancement.
