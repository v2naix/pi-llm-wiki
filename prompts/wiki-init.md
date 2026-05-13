---
description: Initialize a new LLM Wiki in the current directory. Creates the full directory structure, config, and template files.
argument-hint: "<topic> [--mode personal|company]"
section: LLM Wiki
topLevelCli: true
---

# /wiki-init

Initialize a new LLM Wiki in the current directory.

## User Arguments

$ARGUMENTS

Read the LLM Wiki skill at `.pi/skills/llm-wiki/SKILL.md` (or wherever the skill is installed) first to understand the full schema and conventions.

## Steps

1. Ask the user for the wiki topic and mode (`personal` or `company`)
2. Create the directory structure:
   - `.llm-wiki/raw/articles/`, `.llm-wiki/raw/papers/`, `.llm-wiki/raw/notes/`, `.llm-wiki/raw/assets/`
   - `.llm-wiki/wiki/entities/`, `.llm-wiki/wiki/concepts/`, `.llm-wiki/wiki/sources/`, `.llm-wiki/wiki/syntheses/`, `.llm-wiki/wiki/changes/`
   - `.llm-wiki/outputs/`
   - `.llm-wiki/.discoveries/`
3. Create `.llm-wiki/config.yaml` with the topic, mode, and default settings
4. Create `.llm-wiki/wiki/INDEX.md` with section headings organized by page type
5. Create `.llm-wiki/wiki/LOG.md` with initial entry
6. Create `.llm-wiki/wiki/DASHBOARD.md` with Dataview queries for Obsidian
7. Create `.gitignore` to exclude `.llm-wiki/outputs/` from version control if desired
8. Initialize git repo if not already present
9. Report the structure and suggest first steps: "Drop sources into `.llm-wiki/raw/` and run `/wiki-ingest`"

If `--mode company`, add the `change_detection: true` flag to config.yaml and add a `.llm-wiki/wiki/decisions/` folder.
