# Changelog

Each release has full notes under [docs/releases](docs/releases/). This
file is the short version.

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
