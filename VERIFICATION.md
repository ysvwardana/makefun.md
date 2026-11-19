# Enhancer integrity implementation

## Work branch and baseline

- Work branch: `fix/makefun-enhancer-integrity`.
- Initial local HEAD: `ba8e7f84f50e5c49f70658162716ee6a96141d90`.
- Existing uncommitted OpenAI-compatible/provider hardening changes were inspected and retained. They were not reset or replaced with the remote implementation.
- Requested audit baseline `10afe9a` was unavailable in the original local object database. After fetching `origin`, it was inspected along with `1172f19`; `origin/main` points to `10afe9a` (`feat: support database-stored API keys`). Remote changes were not merged over the pre-existing local OpenAI-only implementation. No project AGENTS.md was present in the repository or parent directories checked.
- No push or deployment was performed. Live checks used an isolated local verification server/database.

## Implemented flow

Sync bounty → select bounty → capture exact standard prompt plus fresh requirements → Enhance with AI → review generated additions and gate uncertainty → Copy Master Prompt for manual use in Hermes.

- Standard text is selected only from an explicit prompt source. The live Make.fun anonymous standard prompt was verified in the bounty page's unique `p.crawl-body-prompt` element. HTML entities are decoded and surrounding whitespace is preserved. Missing or ambiguous sources block enhancement and offer manual input. Pasting the entire prompt captures clipboard text before textarea line-ending normalization.
- Brief, rules, deliverables, judging and every gate remain separate model context. Requirements are requested explicitly as JSON using `?format=json`; current official content negotiation can otherwise return Markdown.
- Immutable snapshots record source, time, full SHA-256 identities, refresh issues and completeness. Manual source updates create new snapshots. Additive SQLite migrations retain old rows and mark unproven versions `legacy_unverified`.
- Every enhance refreshes detail/requirements. Failed required refresh cannot silently select cache; the user must choose a specific prior snapshot. Analysis evidence records the actual snapshot, exact sent-message hash, capture time, provider/model, cache flag and every active gate's coverage.
- The configured context ceiling rejects oversized input with section lengths and uncovered gate IDs. It does not silently truncate mandatory rules. Omitted optional leaderboard bulk and unrelated activity fields are explicitly disclosed in the sent context.
- The provider generates Parts 2 and 3; only output structure and the deterministic gate checklist are templated. Missing/duplicate/unknown gate coverage remains uncovered, with a reason. Coverage is a proposed verification plan, never an executed compliance pass.
- Studio HTTP responses project optional large activity/leaderboard collections into a bounded, labeled preview. The immutable raw sources stay in SQLite, and every requirement/check plus exact standard prompt stays intact. This avoids multi-megabyte inspector/browser overload without changing evidence identity or model input.
- Context, enhance, manual source, reuse and save requests are abortable and generation/slug guarded. An old A response cannot overwrite B or a new A selection. Same-slug backend refreshes coalesce; distinct global sync cursor/options queue without overlapping.
- Save validates bounty, analysis, snapshot, source and hashes in one transaction. Part 1 and complete Markdown come from the server source. Stale-rule acknowledgment is bound to the observed rule hash or exact persisted snapshot identity, so a concurrent newer snapshot requires review again.
- Copy/export/save re-check current rules, while keeping the editor's original Part 1 bound to its snapshot. Direct history/library reuse routes through Studio review. Completed unsaved analysis text can be recovered from its stored provider response and source evidence.
- Settings interval now controls a server-owned scheduler; manual sync remains available. Status polling broadcasts successful list updates so newly discovered bounties appear in Studio without restarting.

## Automated verification

Commands completed successfully:

```text
bun install --frozen-lockfile
bun run lint
bun run build
COSMICLABS_DB_PATH=:memory: bun x tsx --test tests/*.test.ts
```

PowerShell equivalent for test isolation: `$env:COSMICLABS_DB_PATH=':memory:'` followed by the test command.

Latest suite: **52 tests passed, 0 failed**. It covers exact Part 1 including mixed CR/LF and edge whitespace, Markdown export bytes, absent source, failed rules refresh and explicit cache choice, full context/overflow, uncovered or ambiguous gates, stale A→B→A responses, cross-bounty analysis rejection, stale confirmation races, additive legacy migration, and scheduler concurrency/rescheduling. Offline HTTP integration proves a second sync adds a new bounty to a populated database and that the new bounty can be selected, enhanced and saved with valid provenance. Tests also verify unsaved analysis recovery.

The latest managed Windows run used a temporary Node preload for the host's `uv_os_get_passwd` failure in `tsx`. The preload supplies a test-only username if that specific lookup fails. Dev startup used the same workaround and returned HTTP 200 for `/` and `/api/health` on `127.0.0.1:3000`.

Real Chrome fixture checks passed eight assertions: list update without restart; late Alpha response while Beta is selected; A→B→A late HTTP 200; Beta enhancement; clipboard identity; verified saved version; and no accidental Alpha history. Optional external research was intercepted; mock output is explicitly fixture-only.

## Live verification and limits

- Live Make.fun sync/details verified anonymous standard text and 55 raw requirement checks for `token-radar-01`; 37 checks were active at the time of testing.
- With the former default of 200,000 characters, full context was rejected with HTTP 413 before a provider call. A measured complete context was about 235,000 characters. The current default is 400,000 characters. The context builder still rejects overflow without truncating required content.
- An isolated test-only override `LLM_MAX_CONTEXT_CHARS=400000` permitted the configured `cx/gpt-6.1-sol` provider to complete an analysis. The reviewed result recorded 37 active gates, with 7 uncovered. This ceiling override did not change the user's .env or the production default. Character ceilings are application policy, not provider token-count guarantees.
- The final live run synced, selected, and enhanced `token-radar-01` with HTTP 200 using the isolated 400,000-character ceiling. The first Copy attempt did not complete in that run. A separate Chrome run recovered a previously stored live analysis for the same bounty, refreshed the current rules, acknowledged the stale-rules warning, and copied all three sections. The 112-character Part 1 matched exactly after accounting for Windows Chromium converting clipboard LF to CRLF. The app passes the original string to the clipboard API, and the Markdown export preserves the original line endings. Save was verified by the fixture HTTP and browser workflows.
- Build warnings remain: existing Vite `__dirname` compatibility warning and a frontend chunk larger than 500 kB. These do not fail the build.
- Submission, wallet actions and Hermes execution remain user-controlled; Make.fun access performed by the application is read-only.

QA artifacts are stored under ignored `data/qa/`; they are local verification artifacts, not part of the source patch.
