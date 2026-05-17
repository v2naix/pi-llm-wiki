---
description: Process new source packets and synthesize them into wiki knowledge pages.
argument-hint: "[source_id]"
section: LLM Wiki
topLevelCli: true
---

# /wiki-ingest

Process uningested source packets and synthesize them into wiki knowledge pages.

## User Arguments

$ARGUMENTS

## Steps

1. Call `wiki_ingest(source_id=<id if provided>, batch_size=3)` to get sources needing synthesis.
2. If the tool reports "All sources ingested", inform the user and stop.
3. For each source in the returned batch:
   a. Read the extracted text from `raw/sources/<SOURCE_ID>/extracted.md`
   b. Update the skeleton source page in `wiki/sources/` with a proper summary, key entities, and concepts
   c. Use `wiki_ensure_page(type=entity, title=<name>)` for each new entity (people, orgs, tools, products)
   d. Use `wiki_ensure_page(type=concept, title=<name>)` for each new concept (ideas, patterns, frameworks)
   e. Add `[[wikilinks]]` cross-references between related pages
   f. Flag any contradictions with existing wiki content using `⚠️ **Contradiction**` markers
4. After processing the batch, call `wiki_rebuild_meta` to update metadata.
5. Report: "Ingested [N] sources → [M] pages created/updated. [X] contradictions flagged."

**Rules:**
- Never modify files in `raw/` — source packets are immutable after capture.
- Never fabricate information — always cite sources with `[[sources/SRC-...]]`.
- The extension auto-updates metadata — you do NOT need to manually edit `meta/` files.
