# Plan: Restructure wiki vault under `.llm-wiki/`

**Issue:** #22
**Goal:** Move wiki vault content from repo root into `.llm-wiki/` subdirectory for cleaner repo isolation, simpler gitignore, and zero directory name collisions.

## Motivation

Currently a wiki vault scatters `raw/`, `wiki/`, `meta/`, `.wiki/`, `outputs/`, `.discoveries/` across the project root. When the wiki lives inside a larger code repo, this is messy and risks collisions.

## Target layout

```
repo_root/
├── .llm-wiki/               ← All wiki content under one dot-dir
    ├── config.json           ← Vault sentinel (was .wiki/config.json)
    ├── templates/            ← Page templates (was .wiki/templates/)
    ├── raw/sources/SRC-*/    ← Immutable source packets
    ├── wiki/                 ← Editable knowledge pages
    │   ├── sources/
    │   ├── entities/
    │   ├── concepts/
    │   ├── syntheses/
    │   └── analyses/
    ├── meta/                 ← Auto-generated metadata
    ├── outputs/              ← Generated artifacts
    └── .discoveries/         ← Discover tracking
```

Key decisions:
- **Flat hierarchy** — no `.llm-wiki/.wiki/` nesting; config and templates live directly in `.llm-wiki/`
- **Backward compat** — old `.wiki/config.json` sentinel still detected as fallback
- **Migration path** — standalone script moves old vaults to new layout
- **Single PR** — all changes are interdependent; cannot ship incrementally

## Implementation phases

### Phase A: Core path logic (`utils.ts`)

**File:** `extensions/llm-wiki/lib/utils.ts`

- `resolveVaultRoot()` — Check `.llm-wiki/config.json` first (new sentinel), walk up. Fall back to `.wiki/config.json` (old sentinel) for existing vaults.
- `getVaultPaths()` — Return all paths under `.llm-wiki/`:
  - `raw` → `root/.llm-wiki/raw`
  - `wiki` → `root/.llm-wiki/wiki`
  - `meta` → `root/.llm-wiki/meta`
  - `dotWiki` → `root/.llm-wiki`
  - `outputs` → `root/.llm-wiki/outputs`
  - `discoveries` → `root/.llm-wiki/.discoveries`
- `isProtectedPath()` — Update to use VaultPaths (check paths.raw and paths.meta instead of root-relative `raw/` and `meta/`)

**Impact:** All callers of `getVaultPaths()` automatically get new paths. Callers of `isProtectedPath()` need signature update.

### Phase B: Sentinel checks & hardcoded `.wiki/config.json` references

Files that hardcode `join(root, ".wiki", "config.json")` → update to check new sentinel:

| File | What changes |
|------|-------------|
| `extensions/llm-wiki/index.ts:62` | Check `.llm-wiki` dir exists instead of `.wiki/config.json` |
| `extensions/llm-wiki/lib/tools.ts:37` | `requireVault()` — use `paths.dotWiki/config.json` |
| `extensions/llm-wiki/lib/recall.ts:154` | Use `paths.dotWiki/config.json` via `getVaultPaths()` |
| `extensions/llm-wiki/lib/retro.ts:164` | Use `paths.dotWiki/config.json` via `getVaultPaths()` |
| `extensions/llm-wiki/lib/guardrails.ts:53-60` | Manual paths object → use `getVaultPaths()` |
| `extensions/llm-wiki/lib/guardrails.ts:18,27,39` | `isProtectedPath()` callers — pass VaultPaths instead of root |

### Phase C: MCP server (`mcp/index.ts`)

The MCP server has its own copy of `resolveVaultRoot()` and `getPaths()`. These need the same treatment:

- Update `resolveVaultRoot()` to check `.llm-wiki/config.json` first, fall back to `.wiki/config.json`
- Update `getPaths()` to return paths under `.llm-wiki/`
- Update `hasVault()` to use new sentinel
- Update `wiki_status` tool's config path
- Update `wiki_retro`/`wiki_capture_source` vaultPaths construction

### Phase D: Bootstrap creates new structure

`ensureVaultStructure()` in `utils.ts` uses `getVaultPaths()` — no code change needed, it automatically creates the new layout after Phase A.

But the `WIKI_SCHEMA.md` content in `wiki_bootstrap` tool (tools.ts) describes the old layout. Update the schema text.

### Phase E: Templates & documentation

Update all docs and templates that describe the directory layout:

| File | Change |
|------|--------|
| `skills/llm-wiki/SKILL.md` | Architecture diagram, path references |
| `skills/llm-wiki/templates/config.yaml` | Path references |
| `skills/llm-wiki/templates/pages/source.md` | raw_path in frontmatter |
| `skills/llm-wiki/templates/LOG.md` | Path references |
| `prompts/wiki-init.md` | Directory structure steps |
| `prompts/wiki-ingest.md` | `raw/` path references |
| `prompts/wiki-discover.md` | `raw/` path references |
| `prompts/wiki-lint.md` | Path references |
| `prompts/wiki-status.md` | Path references |
| `README.md` | Vault layout, quick start, source packet format |
| `docs/architecture.md` | Architecture diagram |
| `docs/commands.md` | Path references |
| `docs/obsidian.md` | Vault path for Obsidian |
| `docs/configuration.md` | Config path |
| `AGENTS.md` | Path references |
| `assets/architecture.md` | Architecture diagram |

### Phase F: Migration script

**File:** `scripts/migrate-llm-wiki.js`

A one-time migration script that:
1. Detects old-style vault (`.wiki/config.json` exists, `.llm-wiki/config.json` doesn't)
2. Creates `.llm-wiki/` directory
3. Moves: `raw/` → `.llm-wiki/raw/`, `wiki/` → `.llm-wiki/wiki/`, `meta/` → `.llm-wiki/meta/`, `.wiki/` content → `.llm-wiki/` (config + templates), `outputs/` → `.llm-wiki/outputs/`, `.discoveries/` → `.llm-wiki/.discoveries/`
4. Creates `.wiki/migrated-to-llm-wiki` forwarding marker
5. Removes old `.wiki/` empty dir
6. Reports migration summary
7. Dry-run mode via `--dry-run`

Also add as a proper extension tool `wiki_migrate` for convenience.

### Phase G: Tests

**File:** `test/llm-wiki.test.ts`

- `createWikiRoot()` — update to create `.llm-wiki/` structure matching new layout
- `createConfig()` — update to write to `.llm-wiki/config.json` location
- All path assertions — update expected paths
- Add test for backward compat (old `.wiki/config.json` still detected)
- Add test for migration script

## Execution strategy

Single PR containing all phases. Rationale:
- All TypeScript changes are interdependent
- Tests would be red in intermediate states
- The change is internally consistent — deliver as one atomic unit

Version bump: `0.7.0` (breaking change for vault directory structure, with backward compat).

## Backward compat guarantees

1. Old vaults with `.wiki/config.json` as sentinel are still detected
2. Old `getVaultPaths()` kept as `getLegacyVaultPaths()` for migration
3. Migration script handles move cleanly
4. Existing `raw/`, `wiki/`, `meta/`, `.wiki/` paths continue working for read operations until migrated
