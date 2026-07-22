# API Reference

All tools registered by the extension. Parameters marked `?` are optional.

Pi Extension and MCP write methods are Controlled Write Adapters. Equivalent operations use one application-layer operation and Bundle Mutation implementation. Results classify `effect` as `"canonical"`, `"private-only"`, or `"no-op"`, return the Bundle Revision and Mutation Identity, and include independent pinned OKF, Native OKF Contract, and named reference-operation validation results. Private-only projection or administrative operations never claim a canonical commit.

13 tools are always registered. The 3 agent-trajectory tools
(`wiki_capture_trajectory`, `wiki_distill_skills`, `wiki_recall_skill`) are **opt-in,
off by default** (issue #80) — they are only registered when `llm-wiki.trajectories`
is `true`; enable with `/wiki-trajectories on`.

---

## wiki_bootstrap

Initialize a Canonical Knowledge Bundle and its Private Vault Layer. Creates configuration, templates, operating rules, and initial Reserved Documents.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `topic` | `string` | ✅ | Main topic of the wiki |
| `mode` | `string` | — | `"personal"` or `"company"` (default: `"personal"`) |
| `root` | `string` | — | Root directory to bootstrap in (default: current working directory) |

**Returns**

```
details: { root: string, mode: string, topic: string, revision: number, effect: "canonical" | "no-op" }
```

Confirmation text includes the vault path, directory layout, and a prompt to capture the first source.

---

## wiki_capture_source

Capture a URL, local file, or pasted text through the controlled Source Capture Operation. It first establishes one complete immutable Raw Source Packet in the Private Vault Layer, then commits an honest reader-visible Source Concept. Provide exactly one of `url`, `file_path`, or `text`.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `url` | `string` | — | URL to fetch and capture |
| `file_path` | `string` | — | Absolute or relative path to a local file (PDF, md, txt, html, XML, JSON) |
| `text` | `string` | — | Pasted text content to capture directly |
| `title` | `string` | — | Title override (used for `text` captures; inferred from URL/file otherwise) |

**Returns**

```
details: {
  rawSourceId: string,       // stable opaque provenance identity; not a path
  conceptPath: string,       // bundle-relative Source Concept path
  curationState: "captured" | "blocked",
  revision: number,
  effect: "canonical" | "no-op",
  validation: ValidationReport
}
```

Errors with `isError: true` if no vault exists or no source input is provided.

---

## wiki_ingest

Select captured Source Concepts for synthesis. Background synthesis commits the Source Concept update and related entity/topic Concepts atomically through the shared Bundle Mutation boundary. It never asks the model to edit canonical files or private projection files directly.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `source_id` | `string` | — | Process a specific source ID only; leave empty to get the next unprocessed batch |
| `batch_size` | `number` | — | Max sources to return (default: `3`, max: `5`) |

**Returns**

```
details: {
  batch: string[],    // opaque Raw Source Identifiers
  remaining: number   // sources still waiting after this batch
}
```

Each batch entry includes the source title, char count, and the path to read (`raw/sources/{id}/extracted.md`).
Returns a "all sources ingested" message with `{ ingested, total }` when nothing is pending.

---

## wiki_ensure_page

Resolve or safely create a canonical wiki page. Returns immediately if the page already exists
(no overwrite). Uses a built-in template when `content` is not provided.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `type` | `string` | ✅ | Page type: `"entity"`, `"concept"`, `"synthesis"`, `"analysis"`, `"requirement"`, `"skill"`, or `"case"` |
| `title` | `string` | ✅ | Human-readable page title; auto-slugified to a kebab-case filename |
| `content` | `string` | — | Full markdown content for the page; if omitted, the type-appropriate template is used |

**Returns**

```
details: { path: string, created: boolean }
```

`created: false` means the page already existed and was not modified.

---

## wiki_recall

Search both the personal (`~/.llm-wiki/`) and project (`.llm-wiki/`) vaults for pages relevant to
a query. Uses chunk-level scoring, weighted field matching, and pseudo-relevance feedback. Also
called automatically before every agent turn.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | `string` | ✅ | Search query — use the user's full request or key terms |
| `max_results` | `number` | — | Maximum pages to return (default: `5`, max: `10`) |

**Returns**

```
details: {
  query: string,
  matches: Array<{
    id: string,           // folder-qualified page ID, e.g. "concepts/rag"
    title: string,
    type: string,         // "source" | "entity" | "concept" | "synthesis" | "analysis"
    preview: string,      // best-matching chunk or page intro (~200 chars)
    path: string,         // absolute filesystem path to the .md file
    score: number,        // relevance score (higher = better)
    vaultLabel?: string   // "📓 personal" when result is from the personal vault
  }>
}
```

Returns empty `matches: []` with a hint to use `wiki_retro` when the wiki has no matching pages.

---

## wiki_search

Exact keyword search across a fresh revision-bound Private Projection. A stale projection is ignored rather than treated as canonical authority. Use this for lookups when you already know what you're looking for.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | `string` | ✅ | Search term matched against page IDs, titles, and types |
| `type` | `string` | — | Filter results to a specific page type (e.g. `"concept"`, `"entity"`) |

**Returns**

```
details: {
  query: string,
  matches: Array<{ id: string, title: string, type: string }>
}
```

---

## wiki_retro

Save an atomic insight from a completed task as a Retrospective Concept through the shared Bundle Mutation seam. It does not create a Raw Source Packet because it is not a captured external source. The resulting Private Projection is fresh in the same session.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `slug` | `string` | ✅ | Unique kebab-case identifier (e.g. `"jwt-revocation-pattern"`). Used as the filename and for lookups. |
| `title` | `string` | ✅ | Short descriptive title, 60 chars max. Noun phrase, not a sentence. |
| `body` | `string` | ✅ | Markdown content explaining what was learned. Use standard file-relative Markdown links ending in `.md` for related Concepts. |
| `category` | `string` | — | Optional grouping label (e.g. `"frontend"`, `"architecture"`, `"devops"`, `"bugfix"`) |

**Returns**

```
details: { slug: string, title: string, category: string | null }
```

---

## wiki_observe

Record a timestamped, relevance-rated observation during a session. Saved to `wiki/sources/` with
`status: observation`. Immediately searchable via `wiki_recall`. Intended for mid-session capture;
use `wiki_retro` for end-of-task summaries.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `title` | `string` | ✅ | Short descriptive title, ≤80 chars. Noun phrase, not a sentence. |
| `content` | `string` | ✅ | Plain prose: what happened, was decided, or was learned. Preserve specifics (file paths, function names, error messages, numbers). |
| `relevance` | `"low" \| "medium" \| "high" \| "critical"` | ✅ | Retention priority. `low` = routine; `medium` = task context; `high` = non-trivial decisions; `critical` = persistent identity/preference or completed work that must not be redone. |
| `tags` | `string` | — | Space-separated tags for categorisation (e.g. `"auth backend migration"`) |
| `source_context` | `string` | — | What was being worked on (e.g. `"Adding authentication module"`) |

**Returns**

```
details: { slug: string, title: string, relevance: string, tags: string | null }
```

The slug is auto-generated as `obs-YYYY-MM-DD-{title-slug}`.

---

## wiki_lint

Deterministic health check of the wiki. Scans for orphan pages (no inbound links), missing pages
(linked but not created), and contradiction markers. Optionally auto-creates stub pages for
knowledge gaps cited in two or more pages.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `auto_fix` | `boolean` | — | When `true`, auto-creates stub concept pages for gaps mentioned in ≥2 pages (default: `false`) |

**Returns**

```
details: {
  pages: number,
  orphans: number,
  missingPages: number,
  contradictions: number,
  reportPath: string,   // path to the generated lint report .md file
  gaps: number          // knowledge gaps tracked in .discoveries/gaps.json
}
```

The lint report is written to `.llm-wiki/outputs/lint-YYYY-MM-DD.md`.
Contradictions are flagged by the presence of `⚠️ **Contradiction` markers in page content and
always require human review.

---

## wiki_status

Report wiki health and statistics from a revision-bound Private Projection. A stale projection is not read as bundle authority.

**Parameters**

None.

**Returns**

```
details: {
  topic: string,
  mode: string,               // "personal" or "company"
  totalPages: number,
  byType: Record<string, number>,  // e.g. { concept: 4, entity: 2, source: 7 }
  orphans: number,
  gaps: number,
  health: "✅ Good" | "⚠️ Warning" | "🔴 Empty"
}
```

Health is `"⚠️ Warning"` when orphan count exceeds 5, `"🔴 Empty"` when the registry has no pages.

---

## wiki_rebuild_meta

Publish one complete revision-bound Private Projection generation containing the registry, backlinks, embeddings, and private activity views. This operation does not change canonical bytes, Concept Timestamps, or Bundle Revision.

**Parameters**

None.

**Returns**

```
details: { effect: "private-only" | "no-op", pageCount: number }
```

---

## wiki_log_event

Append a structured private administrative event and regenerate the private activity view. This does not edit the canonical root `log.md` Reserved Document or advance Bundle Revision.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `kind` | `string` | ✅ | Event kind label (e.g. `"ingest"`, `"query"`, `"decision"`, `"integrate"`) |
| `details` | `object` | — | Arbitrary additional fields to store alongside the event |

**Returns**

```
details: { kind: string }
```

---

## wiki_watch

Print a ready-to-paste **POSIX crontab line** that runs the full wiki cycle (discover → ingest →
lint) on a schedule by invoking `pi -p "/wiki-run"` headlessly under `/bin/bash -lc` so the
user's shell profile (and the `pi` binary on npm-global / bun / nvm PATH) is imported. **Does
not schedule anything directly** — it returns the command for the user to install with
`crontab -e`. Calling agents should surface the output verbatim and avoid claiming the schedule
is active.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `interval` | `string` | ✅ | `"daily"` (8:00 AM), `"weekly"` (Monday 9:00 AM), `"hourly"`, or `"stop"` (prints crontab removal instructions) |

**Returns**

```
details: {
  interval: string,
  cronSchedule: string,   // 5-field POSIX expression, e.g. "0 8 * * *"
  label: string,          // e.g. "Daily at 8:00 AM"
  cronLine: string,       // full crontab line, tagged "# llm-wiki-autoupdate"
  installed: false        // tool never installs — always false
}
```

Output is appended to `~/.llm-wiki/cron.log` (the directory is created by the cron line itself
via `mkdir -p`). On systems without `/bin/bash`, replace the wrapper with `/bin/sh -c` and
ensure `pi` is in cron's PATH yourself.

When `interval` is `"stop"`, returns `details: { action: "stop_instructions" }` with
instructions for removing the line via `crontab -e` (look for the `# llm-wiki-autoupdate` tag).

---

## wiki_capture_trajectory

Capture the just-completed task's tool-call trajectory into an immutable packet
(`raw/trajectories/TRJ-*`) with a self-contained summary (`extracted.md`). The working-memory
counterpart to `wiki_capture_source`. By default the trajectory is auto-extracted from the live
session; pass `steps` to override. **Opt-in** (issue #80): only available when
`llm-wiki.trajectories` is enabled (`/wiki-trajectories on`).

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `title` | `string` | — | Short descriptive title for the task (≤60 chars). Inferred from the prompt if omitted. |
| `task` | `string` | — | The task/prompt that started the work. Inferred from the session if omitted. |
| `outcome` | `string` | — | `"success"` (default), `"failure"`, or `"partial"` — recorded in the packet manifest |
| `steps` | `array` | — | Explicit trajectory steps (tool-call history). Omit to auto-extract from the live session. |
| `model` | `string` | — | Model that ran the task. Inferred from the session if omitted. |

**Returns**

```
details: {
  trajectoryId: string,    // e.g. "TRJ-2026-06-07-001"
  packetPath: string,      // path to raw/trajectories/TRJ-*/ (packet.json + extracted.md)
  stepCount: number
}
```

Errors with `isError: true` if no vault exists, or with `error: "empty_trajectory"` when no
trajectory can be extracted and no `steps` are provided.

---

## wiki_distill_skills

Return a batch of captured trajectories that have not yet been distilled into `skill` pages. Does
not write anything itself — the model reads each packet and synthesizes reusable skill pages (via
`wiki_ensure_page(type="skill")`) that cite the trajectory IDs. A trajectory counts as "distilled"
once a `skills/` page links to it.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `trajectory_id` | `string` | — | Distill a specific trajectory only; omit for all undistilled |
| `batch_size` | `number` | — | Max trajectories to return (default: `3`, max: `5`) |

**Returns**

```
details: {
  batch: string[],    // trajectory IDs in this batch, e.g. ["TRJ-2026-06-07-001"]
  remaining: number   // undistilled trajectories still waiting after this batch
}
```

Each batch entry includes the title, step/tool-call counts, and paths to read
(`raw/trajectories/{id}/packet.json` and `extracted.md`). Returns an "all trajectories distilled"
message with `{ distilled, total }` when nothing is pending.

---

## wiki_recall_skill

Search distilled `skill` pages and past `case` pages for patterns relevant to the current task —
answers "have I done something like this before?". Filters layered recall (`searchWikiLayered`) to
skill/case pages. Call at the START of a task.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | `string` | ✅ | Search query — use the task description or key terms |
| `kind` | `string` | — | `"skill"`, `"case"`, or `"any"` (default) |
| `max_results` | `number` | — | Maximum pages to return (default: `5`, max: `10`) |

**Returns**

```
details: {
  query: string,
  kind: string,
  matches: Array<{
    id: string,           // folder-qualified page ID, e.g. "skills/jwt-revocation"
    title: string,
    type: string,         // "skill" | "case"
    preview: string,
    path: string,
    score: number,
    vaultLabel?: string   // "📓 personal" when result is from the personal vault
  }>
}
```

Returns empty `matches: []` with a hint to capture work via `wiki_capture_trajectory` /
`wiki_distill_skills` when nothing matches.

---

## Error Shape

All tools return `isError: true` in their result when a hard error occurs (no vault found, missing
required input). The `text` content will contain a human-readable explanation. Check for `isError`
before using `details`.

```ts
{
  content: [{ type: "text", text: string }],
  details: { error: string },
  isError: true
}
```

The most common error is **"No wiki found — run wiki_bootstrap first"**, returned by every tool
except `wiki_bootstrap` itself when `.llm-wiki/config.json` does not exist in the resolved vault
root.
