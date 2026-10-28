# Changelog

Each release has full notes under [docs/releases](docs/releases/). This
file is the short version.

## v0.8.0 — 2026-10-28

Keyword Planner, content automation, and a broken Docker install.
[Full notes](docs/releases/v0.8.0.md)

- **If you download the release ZIP, read the notes.** v0.7.0 was
  changelogged but never published as a release, so ZIP users have not
  had its security fixes. They are in this one.
- **New: Google Keyword Planner** (#51, @Galbir) — real average monthly
  searches and competition, automatic keyword discovery that ranks by
  demand, feeding the schedules, the daily agent and a new
  `get_keyword_ideas` MCP tool. Free of charge, but it needs a Google
  Cloud project with Basic API access (brand verification required);
  the auto-approved Explorer tier excludes Keyword Planner.
- **Automations** (#48, @Galbir) — WooCommerce product posts read from
  the public Store API, GBP button choice and Offer posts, post length
  as a setting (default 300 chars), per-schedule keyword choice, product
  blog articles and roundups, Markdown export of blog drafts with
  frontmatter, and editing a schedule in place.
- **Fixed:** content schedules only ran inside the 24h daily sweep, so a
  slot could be skipped for a day; they now have their own 15-minute
  runner.
- **Fixed:** Romanian keyword ideas came back in Vietnamese — the
  language id was 1040, Romanian is 1032.
- **Fixed #47:** the Docker image carried browsers for a different
  Playwright release, so rank checks, SERP scraping and screenshots
  failed on every Docker install — and the error told Linux users to
  press a button on a Windows launcher.
- Corrected: the README claimed 22 MCP tools where there are 23, and
  claimed Keyword Planner needed only "a free Google Ads account".
- No database migrations. WordPress plugin unchanged at 0.6.1.
  `pnpm install` is required: #51 adds a dependency.

## v0.7.0 — 2026-10-22

Security and reliability. [Full notes](docs/releases/v0.7.0.md)

- **Security:** data exports (`*.csv`, disavow file, plan PDF) could be
  downloaded without signing in on password-protected installs — fixed.
- **Security:** team roles are enforced on every server action: viewers
  read-only, settings and admin actions owner-only, members limited to
  their clients. Backup, restore and update require the owner.
- **Security:** sign-in attempt limits; portal AI chat and public grader
  rate limits that can't be bypassed with a forged header; Secure cookie
  behind HTTPS proxies; health check no longer exposes the install path.
- **Fixed #43:** Google Business Profile posting (uses the client's
  listing, valid call-to-action, readable errors, Retry / Publish now).
- **Automation:** weekly jobs no longer depend on running on a Monday;
  rank checks run daily in rotation and report blocked checks honestly;
  capped jobs reach every client; failing reports and jobs back off.
- **New:** workspace time zone for scheduled reports; "last day of the
  month" schedules.
- **Fixed:** duplicate recurring tasks; repeated invoice numbers; invalid
  invoice lines silently dropped.
- **Backups:** download the encryption key alongside `data.db`.
- **Updates rebuild the app** automatically on the next start (they used
  to keep serving the old build).
- No database migrations. WordPress plugin unchanged at 0.6.1.

## v0.6.3 — 2026-10-19

Link intersect, and a run of confident wrong answers corrected.
[Full notes](docs/releases/v0.6.3.md)

## v0.6.2

A terminal command and a lookup the software should do itself.
[Full notes](docs/releases/v0.6.2.md)

## v0.6.1

Two reported issues, and three more found behind them.
[Full notes](docs/releases/v0.6.1.md)

## v0.6.0

[Full notes](docs/releases/v0.6.0.md)

## v0.2.0

[Full notes](docs/releases/v0.2.0.md)
