# Claude Code on your tasks

Clients whose site is a local project (Astro, Next.js, plain HTML) have no CMS for the tool to write through. For them, Claude Code does the work in the project folder, and you watch it from the app.

This only works when you use the app on the computer that runs it, signed in as the owner. Claude edits files and runs commands there, so every route refuses anything else.

## Set up a client

On **Clients → Edit**:

| Field | What it does |
| --- | --- |
| Local project folder | Where Claude works. Chats start in this folder. |
| GitHub repository | `owner/name`. Pick from your repos (uses the `gh` sign-in; the app never stores a token). |
| Base branch | The branch pull requests target (default `main`). |
| Pull-request mode | `Edit files only`, `Open a pull request`, or `Open and merge`. |

Install and sign in to the [`claude`](https://docs.claude.com/en/docs/claude-code) CLI and, for pull requests, the [`gh`](https://cli.github.com) CLI (`gh auth login`).

## Working a task

- **Open in Claude** on a task, or the **Claude** button at the bottom right of every page (the dock). Chats stay open across pages and keep running when the window is minimized.
- Claude reads the task through the `seo-tool` MCP (`get_task`), works in the folder, and marks it done with `update_task`.
- The conversation is saved and resumable. Send more messages to steer it.
- `Tab` takes Claude's suggested reply, like in the terminal.
- **Move to next task ▸** (when Claude is idle) goes on with the client's other open tasks, highest priority first, and opens the next chat.

### Pull-request modes

| Mode | What Claude does per task |
| --- | --- |
| Edit files only | Changes the files. Git is left alone. |
| Open a pull request | Branch `seo/task-<id>-…`, commit, push, `gh pr create`. Stops there for you to review. |
| Open and merge | The same, then waits for the checks and merges (`--squash --delete-branch`) only when local checks and every PR check are green. After two failed attempts it leaves the PR open and says why. |

Never allowed, whatever the mode: force-push, pushing to the base branch, deleting branches, `git reset`, `git clean`. The allow and deny lists are in `src/lib/task-chat/workflow.ts`.

### Model and effort

At the bottom of every chat there are two lists: the **model** (Claude's default, Fable, Opus, Sonnet, Haiku) and the **effort** (default, low, medium, high, xhigh, max). They are saved for the whole workspace and apply from the next message; a turn already running is not changed. "Default" passes nothing, so Claude Code uses your own settings.

## Run everything

- **Tasks → Run all of <client>'s tasks with Claude → Start queue** works all open tasks of a client, high priority first, one chat each. Nothing closes when a task finishes. A task is tried once per run, and three failures in a row stop the run.
- The queue lives in memory: restarting the app ends the run (finished tasks keep their status and chats).

## Autopilot per client

**Agent → Autopilot → Autopilot per client** sets, for each client:

- the level: follow the workspace, or `Off`, `Suggest only`, `Fix the obvious things`, `Full autopilot`;
- who does the work: pick automatically, WordPress / WooCommerce, or Claude Code (local folder).

Automatic choice: a client with a WordPress connection (`wpEndpoint` + `wpKey`, the bridge) is changed through it; otherwise a client with a local folder is worked by Claude. Nothing in the WordPress path changed.

For Claude clients, the autopilot turns new AI suggestions and audit findings into tasks, then hands them to the queue:

- *Fix the obvious things*: title, meta description and H1 rewrites, and plain "missing" findings (meta description, title, alt text, canonical, social tags, schema).
- *Full autopilot*: every open task.
- The scheduled run (every 6 hours) keeps to "actions per run". **Run now** takes everything and opens the first chat.

Without a GitHub repo in a pull-request mode, Claude edits the files directly; the page warns about it.

## What Claude may run

Headless chats cannot ask for permission, so anything not listed is refused. Allowed: reading and editing files in the folder, `git status/diff/log`, the project's `build`/`lint`/`test` scripts, `WebFetch`, `WebSearch`, the `seo-tool` MCP, and (per mode) the git and `gh pr` commands above. Chats are told not to add `Co-Authored-By` or "Generated with" lines to commits and pull requests.

## Troubleshooting

- **429 "Too many requests on this token"**: the MCP endpoint allows 600 requests a minute per token, shared by every chat. Chats wait and retry; refusals are logged as `[mcp] rate limited …`.
- **"Run was interrupted"**: the app restarted while Claude was working. Send a message to continue.
- **Chat says the folder is missing**: set the Local project folder on the client's Edit page.

## Ideas for later

The runner (`src/lib/task-chat/runner.ts`) is the only place that knows about the `claude` CLI: it spawns the process, feeds the prompt, and turns its JSON stream into chat events (`events.ts`). Supporting other coding agents means giving that file a second implementation behind a small interface:

- **Other agents**: Cursor (`cursor-agent`), OpenCode, Codex CLI, Gemini CLI. Each needs an adapter for starting a turn, resuming a session, listing allowed tools, and parsing output into the existing event kinds. A per-client or per-workspace "agent" setting would choose which one.
- **Per-client model and effort**, and a cost cap per run (the dock already shows cost per chat).
- **A queue that survives restarts**, stored in the database instead of memory.
- **"Changes per day" for the Claude path**, matching the WordPress guardrail.
- **Review before merge** by a second pass, or by a person, for `pr_merge` clients.
- **Branch previews** (Cloudflare Pages, Vercel): show the preview link on the task.
