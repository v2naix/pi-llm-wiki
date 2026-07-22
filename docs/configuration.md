# Configuration

Wiki configuration lives in `.llm-wiki/config.json`.

## Modes

### Personal

The personal vault lives at `~/.llm-wiki/` (or `$WIKI_HOME`) and is always available as a fallback when no project wiki exists. It accumulates knowledge across all your sessions.

- Extra folders: `wiki/journal/`, `wiki/goals/`
- Track: learning, books, health, reflections

### Company

- Extra folders: `wiki/changes/`, `wiki/decisions/`
- Track: competitors, market, strategy
- Frontmatter: `confidence: high | medium | low`

## Settings

| Setting                    | Default | Description                        |
| -------------------------- | ------- | ---------------------------------- |
| `max_sources_per_discover` | 8       | Sources fetched per discovery run  |
| `auto_fix_lint`            | false   | Auto-fix lint issues               |
| `batch_ingest_size`        | 3       | Sources processed per ingest batch |

## Environment Variables

| Variable                      | Default     | Description                                     |
| ----------------------------- | ----------- | ----------------------------------------------- |
| `WIKI_HOME`                   | `~/.llm-wiki` | Override the personal wiki vault location     |
| `WIKI_MARKITDOWN_TIMEOUT_MS` | 180000      | Timeout (ms) for MarkItDown PDF/text extraction |

## Vault Resolution

The vault root is resolved in this priority order:

1. **Project vault**: walk up from current directory looking for `.llm-wiki/`
2. **Personal vault**: fall back to `$WIKI_HOME` or `~/.llm-wiki/`

This means when you're in a project with its own `.llm-wiki/`, that project wiki is active. When you're outside any project wiki, your personal `~/.llm-wiki/` takes over automatically.

## Native OKF Concept frontmatter

Every controlled Concept stores all four core fields at knowledge-write time:

```yaml
---
type: concept
title: Retrieval-augmented generation
description: A retrieval pattern that grounds generation in selected knowledge.
timestamp: "2026-08-08T10:00:00Z"
---
```

`timestamp` is the UTC Concept Timestamp of the latest committed Meaningful Knowledge Change—not capture time, source publication time, filesystem mtime, or model runtime. Producer-owned and unknown safe YAML fields are semantically preserved. Source Concepts may additionally carry opaque provenance identifiers and safe resource URIs; private paths are forbidden.

The root Navigation Index declares OKF version `0.1`. The implementation pins the profile to specification commit `ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a`; unknown versions are read best-effort and diagnosed as outside the pinned profile.
