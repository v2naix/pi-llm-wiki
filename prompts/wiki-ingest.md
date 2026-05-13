---
description: Process new source files in raw/ and update the wiki. Creates summaries, entities, concepts, and cross-references.
argument-hint: "[path]"
section: LLM Wiki
topLevelCli: true
---

# /wiki-ingest

Process new files in `.llm-wiki/raw/` and integrate them into the wiki.

## User Arguments

$ARGUMENTS

Read the LLM Wiki skill at `.pi/skills/llm-wiki/SKILL.md` first to understand the full schema, page formats, and conventions.

## Steps

1. Read `.llm-wiki/config.yaml` and `.llm-wiki/.discoveries/history.json`
2. If a specific path is given (e.g., `/wiki-ingest .llm-wiki/raw/articles/my-file.md`), process just that file
3. If no path given, scan all files in `.llm-wiki/raw/` (respecting `.gitignore` — skip any matched files) and find ones not in history
4. For each new source:
   a. Read the full content
   b. Briefly discuss with the user: "This is about [topic]. Key points: [summary]. Any specific emphasis?"
   c. Create/update pages in `.llm-wiki/wiki/sources/`, `.llm-wiki/wiki/entities/`, `.llm-wiki/wiki/concepts/`
   d. Add `[[wikilinks]]` cross-references between related pages
   e. Flag any contradictions with existing wiki content
5. Update `.llm-wiki/wiki/INDEX.md` with all new/updated pages
6. Append to `.llm-wiki/wiki/LOG.md`
7. Update `.llm-wiki/.discoveries/history.json`
8. Report: "Ingested [N] sources → [M] pages created/updated. [X] contradictions flagged."

**Rules:** Never modify raw/ files. Never fabricate information. Always cite sources.
