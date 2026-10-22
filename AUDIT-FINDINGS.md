# Codebase Audit — Bugs, Wiring Problems, Improvements & Missing Features

**Version audited:** v0.6.3 (`main` @ `b80e0af`) · **Date:** 2026-10-22 · **Fixed in:** v0.7.0

## How this audit was done

| Check | Result |
|---|---|
| `pnpm typecheck` | ✅ clean |
| `pnpm lint` | ✅ clean |
| `pnpm test` (97 files, 1,147 tests) | ✅ all pass |
| `npx drizzle-kit generate` (schema vs migrations) | ✅ "No schema changes" |
| `scripts/wiring-audit.ts` | 91/92 tools fully wired (gap: `link-intersect`, see #24) |
| `scripts/route-sweep.mjs` against a production build | 218/222 pages load. The 4 "broken" ones are 404s for records missing from the test DB (`/audits/1`, `/invoices/1`, `/keywords/1/*`), which is expected |
| Live HTTP tests against a running server with `APP_PASSWORD` set | Used to confirm finding #1 |
| Manual code review | Auth, middleware, scheduler, daily agent, reports, tasks, invoices, public endpoints, portal, grader, WP plugin auth |

The automated checks are all green, so every finding below comes from reading code or poking a running server. Each finding is labelled **[verified live]** if I reproduced it against a running instance, or **[code]** if I traced it in source.

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low

---

## Status — fixed in v0.7.0

Every finding below was addressed in **v0.7.0** ([release notes](docs/releases/v0.7.0.md)), together with reported issue #43 (GBP posting). Where a fix differs from the suggestion here, or is partial, the reason is given:

| # | Status |
|---|---|
| 1–21, 23–25, 27, 28, 30 | ✅ Fixed, with tests |
| 22 | ✅ Deleting a client is owner-only. **Not done:** an archive/pause state (listed under missing features; it needs a migration and filtering everywhere) |
| 26 | ⚠️ **Not fixed.** The tracing warning comes from shared server chunks; `turbopackIgnore` hints didn't remove it. It only affects the size of the optional standalone package (`pnpm package`), not the release zip, Docker or the app |
| 29 | ✅ Handled differently: declaring the indexes in `schema.ts` would make `drizzle-kit` emit `CREATE INDEX` statements that fail on existing databases during upgrade. Instead, a test (`src/db/migration-indexes.test.ts`) fails if any index the migrations create is missing after migrating |

Also found and fixed while verifying the upgrade path:
- **Updates never rebuilt the production bundle.** The launcher's Update button and Settings → Update pulled new code, but the app kept serving the old `.next` build. `start:daily` now rebuilds once when the build's version stamp doesn't match `package.json`.
- With no password, a request whose `Host` header named another machine still passed the admin "local only" check, because Next builds `request.url` from the bound address.
- The page monitor called `revalidatePath` from the background scheduler, which throws there; the old catch-all hid it.

Known limitation: members are limited to their clients wherever an action receives a client id. A few actions receive only an item id (a task, an invoice); those are role-checked but don't yet resolve the item's client.

---

## Summary table

| # | Sev | Area | Finding |
|---|---|---|---|
| 1 | 🔴 | Security | Every `*.csv`, `*.txt` and `plan.pdf` export bypasses the login gate |
| 2 | 🔴 | Security / Teams | Team roles are mostly cosmetic: server actions don't enforce viewer read-only, owner-only settings, or per-client access |
| 3 | 🟠 | Security | Admin endpoints (backup, restore, update, shutdown) let *any* logged-in user through when `APP_PASSWORD` is set |
| 4 | 🟠 | Wiring | Edge worker (`/api/edge/fixes`) is blocked by the login gate on any password-protected install |
| 5 | 🟠 | Wiring | Per-client disavow and keyword exports ignore the client and export **every** client's data |
| 6 | 🟠 | Automation | Weekly rank sweep only runs if the agent happens to tick on a **Monday (UTC)**, so laptop and desktop users can go weeks without rank checks |
| 7 | 🟠 | Automation | Rank sweep caps at 30 keywords a week across all clients, and failed checks are counted as successes |
| 8 | 🟠 | Automation | Several daily/weekly steps only ever process the *first* N clients or keywords; the rest are never covered |
| 9 | 🟠 | Automation | A failing scheduled report retries every 15 min forever: PDF rebuilt each time, error spam in the activity log |
| 10 | 🟡 | Automation | Scheduler has no backoff: a failing runner retries every 60 s, and ticks can overlap |
| 11 | 🟡 | Automation | Page monitor says "hourly" but is actually 24 h, and it swallows its own errors, so failures never show in Automations |
| 12 | 🟡 | Tasks | Recurring tasks: re-ticking spawns duplicate copies, and the copy loses assignee, estimate and tool link |
| 13 | 🟡 | Tasks | Bulk "mark done" skips recurrence and the activity log |
| 14 | 🟡 | Invoices | Invoice numbers come from `count()+1`, so deleting one produces duplicate numbers; no unique constraint; never resets per year |
| 15 | 🟡 | Invoices | Invalid line items are silently dropped instead of reported |
| 16 | 🟡 | Security | Public grader rate limit can be bypassed with a spoofed `X-Forwarded-For`, and visitors without the header share one bucket |
| 17 | 🟡 | Security / Cost | Client-portal AI chat has no rate limit and no cap on history size, so anyone with the link can burn the agency's AI credits |
| 18 | 🟡 | Security | No brute-force protection on `/api/auth/login` |
| 19 | 🟡 | Reports | Scheduled report hour uses server-local time (UTC in Docker); there's no timezone setting |
| 20 | 🔵 | Security | Password-mode cookie isn't `Secure` behind a TLS-terminating proxy |
| 21 | 🔵 | Security | Public `/api/v1/health` returns the absolute install path and PID |
| 22 | 🔵 | Data safety | Deleting a client hard-deletes everything; no archive or undo; no role check |
| 23 | 🔵 | Data safety | Backup UI doesn't mention that `.seo-encryption-key` is needed to restore saved API keys |
| 24 | 🔵 | Wiring | `link-intersect` doesn't record findings (the only gap from the wiring audit) |
| 25 | 🔵 | Framework | `middleware.ts` is deprecated in Next 16 (renamed to `proxy.ts`) |
| 26 | 🔵 | Build | Turbopack warns that `next.config.ts` traces the whole project into the build output |
| 27 | 🔵 | API | `/api/v1/*?limit=abc` passes `NaN` into `.limit()` |
| 28 | 🔵 | Code hygiene | Literal NUL bytes in source files make `grep` treat them as binary |
| 29 | 🔵 | Data model | The 64 DB indexes exist only in hand-written SQL, not in `schema.ts` |
| 30 | 🔵 | Docs | README "Coming soon" and `docs/ROADMAP.md` list features that already ship, and claim "daily rank tracking (unlimited keywords)" |

---

## 🔴 Critical

### 1. Export routes bypass authentication entirely **[verified live]**

**Where:** `src/middleware.ts:271`

```ts
matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"]
```

The `.*\\..*` exclusion is meant to skip static assets, but it skips **any path containing a dot**. That includes every data-export route:

- `/clients/export.csv` (names, emails, phones, addresses, GSC/GA4 IDs)
- `/keywords/export.csv`, `/tasks/export.csv`, `/backlinks/export.csv`, `/backlinks/disavow.txt`
- `/audits/export.csv`, `/reports/export.csv`, `/competitors/export.csv`, `/monitor/export.csv`, `/outreach/export.csv`
- `/clients/[id]/plan/export.csv`, `/clients/[id]/plan/plan.pdf`

None of these handlers check auth themselves.

**Reproduced:** started the app with `APP_PASSWORD=secret123`.
- `GET /clients` → `307 /login` (protected, as expected)
- `GET /clients/export.csv` with **no cookie** → `200` and the full client list, including the client I inserted

The same holds in accounts mode. Even with a session, a `member` gets every client because the handlers never apply `clientScope()`.

**Fix:**
- Tighten the matcher to exclude only real static extensions, e.g. `.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|js|css|map|txt|webmanifest)$`, and explicitly keep `.csv` and `.pdf` routes gated. Better still, rename the export routes to `/clients/export?format=csv` so they contain no dot.
- Add `clientScope()` / `canSeeClient()` filtering inside every export handler.
- Add a route-sweep check that requests every route without a cookie on a password-enabled server and expects 307/401.

### 2. Team roles aren't enforced on writes **[code]**

**Where:** `src/lib/auth.ts:225-258` (the role definitions), and roughly 80 `"use server"` action files.

The UI promises:
- **Viewer:** "Read-only on assigned clients"
- **Manager:** "can't add or remove people or change integration keys"
- **Member:** "Only the clients they're assigned to"

The helpers `canEdit`, `canManageSettings` and `canSeeClient` exist, but are only called in:
- `leads/actions.ts`
- `proposals/actions.ts`
- `agent/autopilot/actions.ts`
- team / report-batch code

Everything else accepts a `clientId` or id and acts without checking. That covers `settings/key-actions.ts` (AI keys), `settings/google/actions.ts`, `settings/api-keys/actions.ts`, `settings/smtp-actions.ts`, `clients/actions.ts#deleteClient`, `tasks/actions.ts`, `keywords/actions.ts`, `audits/wp-apply-actions.ts` (pushes changes to live WordPress sites), and more.

Page-level `assertClientAccess()` in `layout.tsx` hides pages but doesn't protect actions, which can be invoked directly with any id. As a result:
- A viewer can edit, delete, and apply WordPress fixes.
- A member can act on clients they aren't assigned to.
- A manager can change API keys.

`/settings` has no role check at all.

**Fix:** add a `requireAccess({ clientId?, need: "edit" | "settings" })` helper and call it at the top of every server action. A unit test can enforce that every exported function in a `"use server"` file calls it. Gate `/settings/*` pages for non-owners. Apply `clientScope()` to `/api/v1/*` and MCP read tools, or scope API keys to clients.

---

## 🟠 High

### 3. Admin guard treats "password is set" as "is the owner" **[code]**

**Where:** `src/lib/admin-auth.ts:147`

```ts
if (process.env.APP_PASSWORD) return null;
```

This guard protects `/api/backup` (download the whole DB), `/api/restore` (replace it), `/api/update` (`git pull` + `pnpm install`), `/api/shutdown`, and `/api/restart`. When accounts exist and `APP_PASSWORD` is also set, the middleware only checks that *some* session exists, so **any viewer** can download or replace the database.

The reverse case also breaks: with accounts on and no `APP_PASSWORD`, a remote owner (VPS behind a proxy without `TRUSTED_PROXY=1`) is locked out of Backup unless the Host header happens to be `localhost`.

**Fix:** in accounts mode, require `currentUser()?.role === "owner"`. Keep the local-only rule only for open mode.

### 4. The edge worker can't reach its endpoint on a protected install **[code]**

**Where:** `src/middleware.ts` `PUBLIC_PATHS`; `src/app/api/edge/fixes/route.ts`

`/api/edge/fixes` uses its own Bearer token and is called by the Cloudflare worker (`edge-worker/seo-tool-worker.js:183`), which has no cookie. It isn't in `PUBLIC_PATHS`, so once `APP_PASSWORD` or accounts are on, the middleware returns 401 before the route's token check runs. The worker then silently serves the origin unchanged, so edge fixes stop applying with no visible error.

**Fix:** add `"/api/edge"` to `PUBLIC_PATHS`, the same way `/api/mcp` and `/api/webhooks` are handled.

### 5. Per-client exports export every client **[code]**

| Link | Sends | Route reads | Result |
|---|---|---|---|
| `backlinks/c/[clientId]/page.tsx:99` → `/backlinks/disavow.txt?clientId=…` | `clientId` | `searchParams.get("client")` (`disavow.txt/route.ts:10`) | Disavow file for **all** clients |
| `keywords/c/[clientId]/page.tsx:225` and `reports/c/[clientId]/page.tsx:396` → `/keywords/export.csv?clientId=…` | `clientId` | Nothing; `GET()` takes no request (`keywords/export.csv/route.ts:15`) | Keywords for **all** clients |

Uploading a disavow file that contains another client's domains to Google Search Console is a real-world SEO accident.

**Fix:** read `clientId` in both routes and filter by it, then add a test that the link's params match what the route reads.

### 6. Weekly rank checks only happen if the agent runs on a Monday **[code]**

**Where:** `src/lib/daily-agent.ts:93`

```ts
if (startedAt.getUTCDay() === 1) { weeklyRankSweep; weeklyAiAuditStep; weeklySerpFeatureStep }
```

The daily agent runs every 24 h *measured from the last finish*, so its start time drifts later each day. Two things go wrong:
- **(a)** If the app isn't running on a Monday (the common case for the Windows/Mac desktop launchers), that week's rank sweep, AI audit and SERP-feature snapshot never happen.
- **(b)** When the drift crosses midnight UTC on Sunday→Monday, Monday is skipped entirely.

**Fix:** store `weekly.last_run_at` and run the weekly block when it's ≥ 7 days old, whatever the weekday. Better, move it to its own scheduler runner with `everyMs: 7d`, which `scheduler.ts` already supports.

### 7. The rank sweep is tiny and misreports failures **[code]**

**Where:** `src/lib/daily-agent.ts:409-455`

- **Limited to 30 keywords per week, total, across all clients.** An agency tracking 300 keywords gets each one checked about every 10 weeks. That contradicts README/ROADMAP's "daily rank tracking (unlimited keywords)".
- `checkRankAction` *returns* `{ ok: false }` and doesn't throw, but `weeklyRankSweep` only counts thrown errors as failures (`:440`). A fully blocked sweep therefore reports "checked 30 keywords".
- `keywordsNeedingRankCheck` has no `ORDER BY`, and a failed check writes no ranking row. The same first 30 failing keywords get picked every week, and the rest are starved.

**Fix:** check `result.ok`. Order by oldest `checkedAt` (nulls first). Make the cap a setting, spread checks daily (e.g. 1/7th of keywords per day), and fall back to GSC average position (`rank-gsc.ts` exists) when scraping is blocked.

### 8. Background steps never reach clients beyond the first N **[code]**

Each of these in `src/lib/daily-agent.ts` takes the first N rows with no ordering or rotation:

| Step | Cap |
|---|---|
| `generateAiSuggestionsForAll` | `.limit(20)` clients |
| `robotsSnapshotStep`, `sitemapHealthStep`, `trafficDropAlertStep` | `slice(0, 30)` clients |
| `weeklyAiAuditStep` | `slice(0, 8)`, applied *before* the freshness skip, so clients 9+ are never audited even when 1–8 are fresh |
| `weeklySerpFeatureStep` | `.limit(30)` keywords, always the same 30 |

Client #31 never gets robots.txt change alerts, sitemap health or traffic-drop alerts, and there's no warning anywhere.

**Fix:** order by "last processed at" and rotate. Apply the freshness filter in SQL before the limit. Surface "X of Y clients covered" in the step summary.

### 9. A failed scheduled report retries every 15 minutes forever **[code]**

**Where:** `src/lib/report-mailer.ts:152`

If sending fails (SMTP not configured, bad recipient, PDF error), `fireSchedule` logs an error and returns **without advancing `nextSendAt`**. On every scheduler tick the report is due again, so the PDF is regenerated with Playwright and another error row is written to the activity log, about 96 times a day, until someone notices. `runDueSchedules()`'s `errors` array is also discarded, so the Automations screen shows the runner as healthy.

**Fix:** add `failureCount`/`lastError` columns with exponential backoff, and disable the schedule after N failures with a notification. Return the errors to the scheduler so they appear in Settings → Automations.

---

## 🟡 Medium

### 10. Scheduler: no backoff, and ticks can overlap **[code]**

**Where:** `src/lib/scheduler.ts:277, 295, 311`

- A runner that throws leaves `finished_at` unchanged, so it retries on the **next 60 s tick, indefinitely**. A failing weekly crawl or backlink sync runs every minute.
- `setInterval` starts a new `tickScheduler()` every 60 s even while the previous one is still awaiting a long runner. The per-runner `inFlight` set stops duplicates of the same runner, but other runners now run **concurrently**, which defeats the documented "sequential, so SQLite isn't contended" design.
- The 30 min `STALE_RUN_MS` is shorter than a large rank sweep or crawl, so a second process (e.g. two replicas) would start a duplicate.

**Fix:** add a module-level `tickRunning` guard. Back off failed runners with `min(everyMs, 5min * 2^failures)`. Make stale time per-runner.

### 11. Page monitor is daily but presented as hourly, and hides failures **[code]**

**Where:** `src/lib/report-mailer.ts:76-99`

The scheduler registers `page_monitor` as `everyMs: 60 min`, but `tickPageMonitorRunner` has its own 24 h gate. It also writes `last_run` *before* doing the work and wraps the work in `try { } catch { }`. That reintroduces both bugs `scheduler.ts` was written to remove: a crash skips 24 h, and errors never reach Settings → Automations. `tickScheduleRunner` uses the same old pattern with a 5 min inner gate.

**Fix:** remove the inner gates and the catch-all from both, and let the scheduler own cadence and error reporting. Pick one cadence and label it correctly.

### 12. Recurring tasks duplicate and lose data **[code]**

**Where:** `src/app/tasks/actions.ts:59-80`

- Marking done → reopening → marking done again creates a **second** next instance, because every `!done → done` transition spawns a copy. Drag-and-drop on the Kanban board makes this easy to trigger.
- The copy drops `assignedUserId`, `estimatedMinutes`, `toolPath`, `source` and `sourceRef`, so recurring work loses its owner and its tool deep link.

**Fix:** store `recurrenceParentId`/`nextInstanceId` on the task and only spawn once. Copy all of those fields.

### 13. Bulk status change bypasses task logic **[code]**

**Where:** `src/app/tasks/actions.ts` `bulkSetTaskStatus`

Bulk "mark done" neither spawns recurring instances nor writes `task.completed` activity entries, so capacity and monthly reports undercount bulk-completed work.

**Fix:** loop through the same code path as `setTaskStatus` (inside a transaction).

### 14. Duplicate invoice numbers **[code]**

**Where:** `src/app/invoices/actions.ts:35-39`

```ts
`INV-${year}-${String(count + 1).padStart(4, "0")}`
```

- Create 5 invoices, delete #3, and the next one is `INV-…-0005` again (a duplicate).
- Nothing enforces uniqueness on `invoice_number` in the database.
- The sequence never resets in a new year (`INV-2027-0143`).
- Two concurrent creates can get the same number.

For GST-registered Indian users, duplicate invoice numbers are a compliance problem.

**Fix:** store a per-year counter in settings and increment it in a transaction. Add a unique index. Never reuse deleted numbers; void invoices instead of deleting them.

### 15. Invalid invoice line items vanish silently **[code]**

**Where:** `src/app/invoices/actions.ts:83`

`if (lp.success) items.push(...)`: a line with quantity > 10,000 or a malformed rate is dropped without telling the user, so the invoice total is quietly wrong.

**Fix:** return a validation error that names the line.

### 16. Public grader rate limit is bypassable **[code]**

**Where:** `src/app/embed/grader/actions.ts:57`; `src/lib/grader-public.ts:75`; `src/lib/rate-limit.ts:61`

The limiter is keyed on the *first* `X-Forwarded-For` entry. That entry is supplied by the client even behind nginx, which appends the real IP rather than replacing it. Rotating the header gives unlimited free crawls from the agency's server. Without a proxy, `ip` is `null`, so every visitor shares one `"unknown"` bucket, and one visitor can rate-limit everyone else.

**Fix:** use the *rightmost* untrusted hop when `TRUSTED_PROXY=1`, otherwise the socket address. Add a global per-hour cap.

### 17. Portal AI chat can run up the agency's AI bill **[code]**

**Where:** `src/app/portal/[token]/chat-actions.ts:172`

There's no rate limit. Only the *last* message is length-checked; the client-supplied `history` array is unbounded and is concatenated into the prompt. That history can also contain invented "Assistant:" turns. Anyone who gets the portal link (it's emailed and forwarded) can generate unlimited paid AI calls.

**Fix:** cap history at about 10 turns and about 8k characters. Apply a per-token and per-IP rate limit plus a daily portal AI budget. Rebuild history server-side from `chat-store` instead of trusting the client.

### 18. No login brute-force protection **[code]**

**Where:** `src/app/api/auth/login/route.ts`

There's a fixed 250 ms delay but no attempt counter or lockout, and parallel requests ignore the delay. Self-hosted instances exposed through a tunnel or VPS are open to password spraying.

**Fix:** per-IP and per-email limits (e.g. 10 attempts per 15 min) using the existing `checkRateLimit`.

### 19. Report schedules ignore timezone **[code]**

**Where:** `src/lib/report-mailer.ts:26`

`next.setHours(schedule.hourOfDay)` uses the server's local time. In Docker that's UTC, so a "9 AM" report for an Indian agency arrives at 2:30 PM IST. Monthly `dayOfMonth` is silently clamped to 28, so "31st" never means "last day".

**Fix:** add a workspace timezone setting (and optionally per-client), compute with `Intl`, and offer a "last day of month" option.

---

## 🔵 Low

**20. Password-mode cookie not `Secure` behind a proxy.** `src/app/api/auth/login/route.ts:76` uses `req.nextUrl.protocol`, which is `http:` behind a TLS-terminating proxy. The accounts-mode cookie already honours `x-forwarded-proto` (`auth.ts:161`); reuse that helper.

**21. Health endpoint leaks details.** `GET /api/v1/health` is public and returns `installRoot` (an absolute filesystem path) and `pid`. Return these only to loopback callers, which is all the launchers need.

**22. Client deletion is irreversible.** `clients/actions.ts#deleteClient` hard-deletes with cascade: audits, rankings, reports and invoices all go. There's no archive state, no undo and no role check. Add `archivedAt` (hidden from lists, excluded from automations, restorable) and make permanent deletion owner-only.

**23. Backups miss the encryption key.** The Backup page downloads only `data.db`. Restoring on a new machine without `.seo-encryption-key` makes every saved API key and OAuth token unreadable, and the UI never says so. Offer a `.zip` containing both, or show a clear warning.

**24. `link-intersect` writes no findings.** It's the only tool flagged by `scripts/wiring-audit.ts`: its results never become findings or tasks.

**25. Deprecated `middleware.ts`.** `next build` warns that the `middleware` file convention is deprecated and should be renamed to `proxy`. Rename it before the next Next.js major removes support.

**26. Over-broad build tracing.** Turbopack reports "Encountered unexpected file in NFT list … the whole project was traced unintentionally" from `next.config.ts`. This makes the standalone/Docker output and the release zip larger. Scope the `path.join(process.cwd(), …)` calls or add `/*turbopackIgnore: true*/`.

**27. Unvalidated `limit` in the API.** `/api/v1/clients?limit=abc` gives `Math.min(NaN, 200)`, which is `NaN`, and that goes into `.limit()`. Validate with zod and default to 50.

**28. NUL bytes in source.** `src/app/api/restore/route.ts` and `src/lib/edge-fixes.ts` contain literal NUL bytes, so `grep` reports "binary file matches" and code search and review tools skip them. Use the `"\0"` escape instead.

**29. Indexes not declared in the schema.** The 64 indexes exist only in hand-written migration SQL; `drizzle-kit` reports "0 indexes" for every table. Any future drizzle-generated table rebuild (SQLite ALTERs often recreate tables) would drop them silently. Declare them in `schema.ts`.

**30. Stale docs.** `README.md` → "Coming soon" and `docs/ROADMAP.md` ("Last updated: February 2026") list as *future* work several features already in the repo: browser extension (`extension/`), PWA (`sw.js`, manifest), programmatic SEO (`/tools/programmatic-seo`), hreflang (`/tools/hreflang`, `/tools/hreflang-gen`), GitHub PR generation (`/tools/github-pr`), team roles and capacity (`/settings/team`, `/capacity`), and chart annotations (`/annotations`). ROADMAP also claims "Daily rank tracking (unlimited keywords)" and "Daily agent — 17 automated jobs"; see #6–#8.

---

## Day-to-day usability improvements

1. **Navigation overload.** The sidebar has **55 items**, and even "guided" mode shows about 22. Several overlap:
   - Dashboard / Morning briefing / Weekly digest
   - SEO chat / AI agent / Autopilot / AI chat history
   - Local rank tracker / Local rank heatmap
   - Backlinks / Link building / Outreach / Broken links

   Group them into about 7 collapsible sections (Overview, Clients, Rankings, Content, Links, Local, Agency) and let users pin favourites.
2. **Client switcher in the top bar.** Most work is per-client. A persistent "current client" selector would let every tool open pre-filled, instead of choosing the client on each page.
3. **One "Today" inbox.** Merge alerts, due tasks, unanswered reviews, failed automations and reports awaiting approval into one prioritised queue with keyboard triage (`j`/`k`, `d` = done, `s` = snooze).
4. **Automation health banner.** When any scheduler runner has `lastError` or hasn't finished in 2× its interval, show a banner app-wide, not only in Settings → Automations. Most of #6–#11 would have been noticed this way.
5. **Notify on failure.** Send failed report emails, blocked rank sweeps and unreachable sites to the configured Slack/email webhooks; right now they only reach the activity log.
6. **Bulk actions everywhere.** Keywords (tag, move client, delete, check now), audits findings (→ tasks), backlinks (status) and clients (assign team members) would all benefit.
7. **Saved filters and views** on Tasks, Keywords and Backlinks, persisted per user.
8. **Undo toasts** for destructive single actions (delete task, keyword or competitor) instead of confirm dialogs; `sonner` is already installed.
9. **"Check now" with progress** for long jobs (audits, rank sweeps, grids), using a job queue that survives page navigation and shows live progress in the top bar.
10. **Global search shortcuts.** Add actions ("new task for…", "run audit on…") to the existing search palette, not only navigation.
11. **CSV import mapping preview.** Show a column-mapping and preview step before committing keyword and client imports.
12. **Per-client setup checklist on the client page** (GSC connected? GA4? WP plugin? competitors added? keywords tracked?) so it's obvious why a tool shows empty data.

---

## Missing features worth adding

| Feature | Why it matters |
|---|---|
| **Workspace timezone and locale** (dates, currency, report send times) | Needed for #19; agencies in India, UK and US all use this |
| **Client archive / pause** | Paused clients stop consuming automation and AI budget without losing history (#22) |
| **Keyword tags, groups and target URLs** | Standard in every paid rank tracker; also enables page-level reports |
| **Configurable rank-check frequency per client** (daily/weekly) with a GSC fallback | Fixes #6/#7 and matches what the docs promise |
| **Share-of-voice and visibility index** per client vs competitors | The most-requested agency rank metric |
| **Audit-to-audit diff on the client page** ("12 new issues, 30 fixed since last crawl") | The data exists (`/audits/diff`); surface it where people look |
| **Scheduled exports / Google Sheets / Looker Studio connector** | Agencies live in Sheets; the API exists, but no-code sync is missing |
| **Two-factor auth and session list** ("log out other devices") | Needed once the app is exposed for teams |
| **Audit log of who changed what** (settings, WP fixes applied, deletions) | Pairs with fixing #2; activity log has `userId` but not settings changes |
| **Client-facing approval flow for WP/edge fixes** | Client confirms in the portal before the agent applies changes to their live site |
| **Invoice: recurring retainers, payment status, credit notes, GST fields (GSTIN, HSN/SAC, CGST/SGST/IGST split)** | The invoice module targets INR users, but it's missing what Indian invoices legally need |
| **Data retention settings in the UI** | `retention-cleanup` exists; let users choose how long to keep SERP screenshots and AI logs |
| **Health/diagnostics export** ("copy debug bundle": versions, scheduler status, last errors, redacted settings) | Makes GitHub issues actionable; issue #31 was filed with no info |
| **Encrypted, off-site backup target** (S3/Backblaze/Google Drive) | Today's auto-backup sits on the same disk as the DB |

---

## Suggested order of work

1. **Now (security):** #1, #2, #3, #4, #5. Add a test that every route returns 401/307 without a session in password and accounts mode, and that every server action calls the access helper.
2. **Next (automation reliability):** #6, #7, #8, #9, #10, #11, plus usability item 4 (health banner), so automation failures show up instead of going unnoticed.
3. **Then (data correctness):** #12–#15, #19.
4. **Then:** abuse protection (#16–#18), the Low items, docs (#30), and the UX and feature work above.
