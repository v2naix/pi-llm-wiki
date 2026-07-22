# AGENTS.md

Instructions for AI agents working on this codebase.

## Project

`v2naix/pi-llm-wiki` is a fork of the `@zosmaai/pi-llm-wiki` Pi package. It maintains a Markdown knowledge base with immutable source capture, controlled knowledge writes, retrieval, linting, and Obsidian-compatible navigation. Unless a separate publishing decision changes it, `@zosmaai/pi-llm-wiki` remains the upstream npm package identity rather than this repository's identity.

## Sources of truth

- [`docs/specifications/native-okf.md`](docs/specifications/native-okf.md) is the normative authority for Native OKF behavior.
- [`CONTEXT.md`](CONTEXT.md) defines the supporting domain vocabulary.
- If an older plan, research note, prompt, example, test fixture, comment, or this file conflicts with the Native OKF specification, follow the specification and update the stale material.
- Research documents describe pinned external behavior; they are not product requirements.

## Tech stack

- TypeScript (ES2022, ESM)
- Vitest
- Biome
- pnpm
- GitHub Actions

## Repository layout

```text
extensions/llm-wiki/       Pi extension and domain implementation
extensions/llm-wiki/lib/   Native OKF, mutation, source, projection, and tool modules
mcp/                       MCP adapter
skills/llm-wiki/           Bundled skill and templates
prompts/                   Slash-command templates
test/                      Vitest tests
docs/specifications/       Normative product specifications
docs/research/             Supporting research
scripts/                    Release automation
```

Do not encode tool, prompt, or file counts here; those details change frequently.

## Native OKF invariants

- `.llm-wiki/wiki/` is the Canonical Knowledge Bundle. The surrounding `.llm-wiki/` directory is the Private Vault Layer, not part of the distributed bundle.
- Every non-reserved Markdown document in the bundle is a Concept. Controlled writes require non-empty string `type`, `title`, `description`, and ISO 8601 UTC `timestamp` frontmatter fields.
- Exact basenames `index.md` and `log.md` are Reserved Documents at every depth. They are not Concepts and must not enter search, recall, embeddings, backlinks, page counts, orphan checks, or ordinary Concept lint.
- Controlled writers emit standard file-relative Markdown links ending in `.md`. Do not generate Obsidian wikilinks. Readers may recognize wikilinks only to diagnose incompatible external content.
- Unknown Concept types and extension frontmatter fields are valid. Preserve unknown YAML values semantically during controlled read-modify-write operations.
- Raw Source Packets remain immutable private evidence outside the bundle. Never expose private packet paths as bundle links, citations, or public resource metadata.
- Do not infer meaningful metadata from filenames, arbitrary body text, filesystem mtime, or export-time processing.

## Write architecture

- Route every controlled canonical-byte change through the shared Bundle Mutation boundary. Do not add independent canonical writers in tools, hooks, the Pi adapter, or the MCP adapter.
- A Bundle Mutation declares its complete change set, validates preconditions, stages outputs, publishes recoverably, and advances Bundle Revision exactly once on a successful canonical commit. Failures and semantic no-ops do not advance it.
- Equivalent Pi and MCP operations must share validation, mutation, timestamp, provenance, idempotency, concurrency, and result semantics even when their protocol shapes differ.
- Private Projections are rebuildable, revision-bound views. Projection rebuilds must not change canonical bytes, Concept Timestamps, or Bundle Revision.
- Direct external edits are handled through External Reconciliation. Do not silently overwrite unrecognized Concept or Reserved Document edits or invent their historical timestamp or transaction boundary.
- Source capture establishes the immutable Raw Source Packet before committing its Source Concept and must resume safely under the same Mutation Identity after partial failure.

Relevant implementation seams include:

- `extensions/llm-wiki/lib/okf-reader.ts` — semantic bundle reading and layered validation
- `extensions/llm-wiki/lib/okf-mutation.ts` — Bundle Mutation and canonical commit mechanics
- `extensions/llm-wiki/lib/native-okf-application.ts` — shared application operations
- `extensions/llm-wiki/lib/controlled-source.ts` — Source Capture and Source Concept lifecycle
- `extensions/llm-wiki/lib/private-projections.ts` — revision-bound Private Projections
- `extensions/llm-wiki/lib/pi-write-adapter.ts` and `mcp/` — controlled adapters, not independent writers

## Coding conventions

- Prefer cohesive modules with small interfaces and substantial hidden behavior. Extract pure functions where they clarify policy or enable focused tests; do not split code merely to make functions short.
- For new or substantially modified file I/O, use `node:fs/promises`. Do not perform unrelated broad rewrites of stable legacy synchronous code.
- Keep path containment, symlink handling, YAML safety limits, timestamp semantics, and revision checks explicit at their shared boundaries rather than reimplementing them at callers.
- Extension tools must define the Pi tool contract fields used by the current codebase, including `name`, `label`, `description`, `promptSnippet`, `promptGuidelines`, `parameters`, and `execute`.
- Source identifiers use `SRC-YYYY-MM-DD-NNN`. Concept filenames use `kebab-case.md` unless a stricter domain rule applies.
- Do not manually edit generated bundle indexes, the root bundle log, or Private Projection files as if they were source documents.

## Testing

Prefer tests at the highest stable observable seam. Native OKF behavior should primarily be verified by creating or mutating a complete bundle through a public workflow and inspecting it as an external consumer would. Test public outcomes rather than private helper decomposition.

Cover relevant failure paths, including invalid YAML, unknown-field preservation, path escape and symlink handling, stale revisions, idempotent retries, partial publication recovery, reserved-document drift, external reconciliation, and Pi/MCP adapter parity.

```bash
pnpm test
pnpm test:coverage
pnpm typecheck
pnpm lint
```

Run the narrowest relevant test during development, then run the full applicable checks before completion.

## Release

```bash
pnpm run release:patch
pnpm run release:minor
pnpm run release:major
pnpm run release:push
```

Never edit the `package.json` version manually; use the release script.
