# Obsidian Integration

## Setup

Open `.llm-wiki/wiki/` as an Obsidian vault. That directory is the complete Canonical Knowledge Bundle; do not open the surrounding Private Vault Layer as bundle content.

The generated `index.md` Navigation Indexes provide progressive browsing. Standard file-relative Markdown links such as `[RAG](../concepts/rag.md)` work in Obsidian, GitHub, and ordinary Markdown readers. Controlled writers do not emit wikilinks.

## Editing

Human edits made in Obsidian remain legitimate external bundle edits, but they are not controlled transactions. Run External Reconciliation before the next controlled write so the system can validate and admit the observed bytes, request Concept Reaffirmation, or report a conflict. Do not manually edit generated `index.md` or `log.md` Reserved Documents.

Each authored Concept should retain truthful `type`, `title`, `description`, and UTC `timestamp` frontmatter. Do not infer timestamps from filesystem metadata and do not link to `.llm-wiki/raw/`, `.llm-wiki/meta/`, or other private paths.

## Private projections

Registry, backlinks, search, recall, and embeddings live under `.llm-wiki/meta/` as revision-bound Private Projections. They are rebuildable implementation data, not bundle files or write authority. Obsidian's own graph may independently visualize the canonical standard Markdown links.
