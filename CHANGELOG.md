# Changelog

## [Unreleased]

## [0.7.0] - 2026-05-13

### Added
- **Wiki vault restructured under `.llm-wiki/`** (Issue #22, PR #23 by @arjun-zosma): All wiki content now lives in a single `.llm-wiki/` subdirectory — cleaner repo isolation, easier gitignore, zero directory name collisions.
- **Backward compatibility**: Old vaults (`.wiki/config.json` sentinel) are auto-detected and continue to work. New vaults use `.llm-wiki/config.json`.
- **`detectVaultFormat()`** utility: Returns `"new"`, `"legacy"`, or `"none"` for any directory.
- **`resolveVaultPaths()`** utility: Auto-detects vault format and returns correct paths.
- **`getLegacyVaultPaths()`** utility: Returns old-style paths for migration support.
- **Migration script** (`scripts/migrate-llm-wiki.js`): One-time tool to move old vaults to new layout. Supports `--dry-run` and `--force` flags.
- **5 new backward-compatibility tests**: Verify new format detection, legacy format detection, auto-resolution, and no-vault handling.

### Changed
- `resolveVaultRoot()` now checks for `.llm-wiki/config.json` first, then falls back to `.wiki/config.json`.
- `getVaultPaths()` returns paths under `.llm-wiki/`:
  - `raw/` → `.llm-wiki/raw/`, `wiki/` → `.llm-wiki/wiki/`, `meta/` → `.llm-wiki/meta/`
  - `.wiki/` → `.llm-wiki/` (config directly in the dot-dir)
  - `outputs/` → `.llm-wiki/outputs/`, `.discoveries/` → `.llm-wiki/.discoveries/`
- `isProtectedPath()` now takes `VaultPaths` instead of `root` string.
- `wiki_bootstrap` creates new `.llm-wiki/` layout by default.
- MCP server updated with own copy of path detection logic.
- All templates, prompts, documentation, and tests updated to reflect new layout.

### Migration
- Run `node scripts/migrate-llm-wiki.js` in your wiki root to migrate from the old layout.
- Old `.wiki/` directory is preserved as a forwarding marker (`.wiki/MIGRATED_TO_LLM_WIKI.md`).
- No data loss — all content is moved, nothing deleted.

## [0.6.0] - 2026-05-11

### Added
- **Phase 1 — Auto-recall** (PR #19 by @arjun-zosma): New `wiki_recall` tool for explicit searches. Extension now auto-searches wiki before every user turn via `before_agent_start` hook. Matching pages injected as "Relevant Wiki Knowledge" into system prompt. 8 new tests.
- **Phase 2 — Auto-capture** (PR #20 by @arjun-zosma): New `wiki_retro` tool for saving atomic insights from completed tasks. Creates source packets with manifest, extracted text, and source page. 4 new tests.
- **Phase 3 — MCP Server** (PR #21 by @arjun-zosma): Standalone MCP server using `@modelcontextprotocol/server` (v2 SDK) with stdio transport. Exposes 5 tools: wiki_recall, wiki_search, wiki_status, wiki_retro, wiki_capture_source. Cross-platform reach to Claude Code, Cursor, Windsurf.
- **12 extension tools** (up from 10): wiki_recall (auto at turn start) and wiki_retro (manual at task end)
- **SKILL.md**: Auto-Recall section, wiki_recall + wiki_retro tool docs, "Task → Capture → Retro" workflow

### Changed
- Extension registers 12 tools instead of 10
- Status bar now shows "12 tools, auto-recall active"

## [0.5.0] - 2026-05-11

### Added
- **Overhauled README**: npm downloads badge, slash commands table, guardrails section, skill behavior, vault layout, source packet format, integration flow, linking style guide
- **Better npm discoverability**: 19 keywords (was 10), expanded description with search terms, `files` field to slim package
- **GitHub topics**: pi, llm-wiki, knowledge-base, wiki, markdown, obsidian, karpathy, second-brain, pkm, memory

## [0.4.0] - 2026-05-11

- JSON file support (PR #15 by jfraser)
- Extractor strategy pattern refactor

## [0.3.0] - 2026-05-07

- Release

## [0.2.2] - 2026-05-03

- Fix: CodeQL alerts for safe tag stripping and entity decoding
- Fix: README contributors via contrib.rocks
- Added: Features section and env var documentation

## [0.2.1] - 2026-04-29

- Minor fixes

## [0.2.0] - 2026-04-28

### Added

- **4-layer architecture**: raw/, wiki/, meta/, .wiki/ with explicit ownership rules
- **Source packets**: Structured capture with manifest.json, original/, extracted.md, attachments/
- **10 custom tools** (up from 5): wiki_bootstrap, wiki_capture_source, wiki_ingest, wiki_ensure_page, wiki_search, wiki_lint, wiki_status, wiki_rebuild_meta, wiki_log_event, wiki_watch
- **Auto-generated metadata**: registry.json, backlinks.json, index.md, log.md, events.jsonl
- **Guardrails**: Extension blocks direct edits to raw/** and meta/** via tool_call hook
- **Auto-rebuild**: Metadata rebuilds automatically after wiki/\*\* edits via turn_end hook
- **Batch ingest**: wiki_ingest returns source batches with extracted content previews
- **Improved lint**: Orphans, missing pages, contradictions, knowledge gaps with auto_fix option
- **Release scripts**: Automated semver bumping, changelog updates, git tagging
- **Coverage reporting**: v8 coverage in CI with lcov output

### Changed

- Extension moved from single file to modular directory structure (extensions/llm-wiki/)
- Skill reduced from ~500 lines to ~150 lines — principles over mechanics
- Metadata is now machine-owned; LLM never edits INDEX.md or LOG.md manually
- Source IDs use stable format SRC-YYYY-MM-DD-NNN for rename-safe citations

### Removed

- Manual INDEX.md/LOG.md maintenance from skill workflows
- Legacy flat raw/articles/ structure (replaced by structured source packets)
