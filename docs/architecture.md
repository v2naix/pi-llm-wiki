# Architecture

## Layered Vault Architecture

pi-llm-wiki supports multiple vault layers that are searched together:

| Layer | Location | Resolution | Searched by recall |
|-------|----------|------------|-------------------|
| **Personal** | `~/.llm-wiki/` | Fallback when no project wiki found | ✅ Always |
| **Project** | `{project}/.llm-wiki/` | Walk up from cwd | ✅ When present |

### Resolution Order

1. Check current directory for `.llm-wiki/` → use as project wiki
2. Walk up parent directories looking for `.llm-wiki/` → use as project wiki
3. Check `WIKI_HOME` env var → use as personal wiki
4. Fall back to `~/.llm-wiki/` → create if doesn't exist

This means a project wiki is always preferred when you're inside a project that has one, but your personal wiki is always available as the fallback.

### Dual-Vault Recall

`wiki_recall` uses `searchWikiLayered()` which:
1. Searches the **project vault** (if one exists in cwd)
2. Searches the **personal vault** (`~/.llm-wiki/` or `WIKI_HOME`)
3. Deduplicates results by page ID (project takes priority on duplicates)
4. Tags personal results with "📓 personal" label
5. Merges results: personal first, then project

Results are injected into the context with vault source tags so the model can distinguish between personal and project knowledge.

---

## Four-Layer Page Model (within each vault)

```
WIKI_ROOT/
└── .llm-wiki/                 # All wiki content under one dot-dir
    ├── config.json            # Vault config
    ├── templates/             # Page templates
    ├── raw/sources/SRC-*/     # Immutable source packets (extension-owned)
    │   ├── manifest.json      # Capture metadata
    │   ├── original/          # Original artifact
    │   ├── extracted.md       # Normalized markdown
    │   └── attachments/       # Downloaded images, PDFs
    ├── wiki/                  # Editable knowledge pages (you + LLM)
    │   ├── sources/           # One summary per source
    │   ├── entities/          # People, orgs, tools, products
    │   ├── concepts/          # Ideas, patterns, frameworks
    │   ├── syntheses/         # Cross-cutting analyses
    │   └── analyses/          # Durable query answers
    ├── meta/                  # Auto-generated (extension-owned)
    │   ├── registry.json      # Master page catalog
    │   ├── backlinks.json     # Inbound link map
    │   ├── index.md           # Human-readable catalog
    │   ├── log.md             # Activity log
    │   └── events.jsonl       # Structured event stream
    ├── outputs/               # Generated artifacts
    └── .discoveries/          # Discovery tracking
```

## Ownership Rules

| Path      | Owner                    | Rule                     |
| --------- | ------------------------ | ------------------------ |
| Path                  | Owner                    | Rule                     |
| --------------------- | ------------------------ | ------------------------ |
| `.llm-wiki/raw/**`    | Extension                | Immutable after capture  |
| `.llm-wiki/wiki/**`   | Model + user             | Editable knowledge pages |
| `.llm-wiki/meta/**`   | Extension                | Auto-generated           |
| `.llm-wiki/` | Human + explicit request | Operating rules          |

## Source Packet Format

Each captured source becomes a packet:

```
.llm-wiki/raw/sources/SRC-YYYY-MM-DD-NNN/
  manifest.json
  original/
  extracted.md
  attachments/
```

## Page Types

- **source** — what this specific source says
- **entity** — people, orgs, tools, products
- **concept** — ideas, patterns, frameworks
- **synthesis** — cross-source theses and tensions
- **analysis** — durable filed answers from queries

## Linking Style

- Internal: `[[folder/page-name]]`
- Citation: `[[sources/SRC-YYYY-MM-DD-NNN]]`

## Guardrails

The extension blocks direct edits to `.llm-wiki/raw/**` and `.llm-wiki/meta/**`. Metadata rebuilds automatically after `.llm-wiki/wiki/**` edits.
