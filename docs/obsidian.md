# Obsidian Integration

## Setup

1. Open `.llm-wiki/wiki/` as an Obsidian vault
2. The extension generates `.llm-wiki/meta/index.md` as a browsable catalog
3. `.llm-wiki/meta/backlinks.json` is available for graph plugins

## Recommended Plugins

- [Dataview](https://github.com/blacksmithgu/obsidian-dataview) — Query pages by frontmatter
- [Graph View](https://obsidian.md) (built-in) — Visualize `[[wikilink]]` connections
- [Backlinks](https://obsidian.md) (built-in) — See inbound links

## Web Clipper

Use [Obsidian Web Clipper](https://obsidian.md/clipper) to save articles directly into `.llm-wiki/raw/articles/`.

## Dataview Dashboard

The extension creates `.llm-wiki/meta/index.md` with page listings. For custom dashboards, use Dataview queries against frontmatter fields like `type`, `domain`, `category`, `sources`.
