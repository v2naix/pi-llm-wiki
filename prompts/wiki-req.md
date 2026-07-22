---
description: Capture and decompose a concept into atomic, traceable wiki requirements. Clarifies ambiguous requirements, splits them into atomic pieces, and persists them as wiki/requirements/ pages with status tracking.
argument-hint: "<concept description>"
section: LLM Wiki
topLevelCli: true
---

# /wiki-req

Capture a concept and decompose it into atomic, traceable requirements in the wiki.

Transforms natural-language descriptions into Requirement Concepts through controlled writes, preserving the clarified input as an immutable Raw Source Packet associated with a Source Concept.

## User Arguments

$ARGUMENTS

Read the LLM Wiki skill at `.pi/skills/llm-wiki/SKILL.md` first to understand the wiki conventions, architecture, and page type rules.

## Steps

1. **Clarify the concept**
   - Discuss with the user: unpack ambiguous terms, surfaces implicit assumptions, identify scope boundaries
   - Ask targeted questions to resolve unknowns (e.g., "Which providers?", "What's the fallback behavior?", "Who are the actors?")
   - Reach mutual clarity before proceeding

2. **Capture the clarified concept**
   - Call `wiki_capture_source(text=...)` with the clarified conversation as markdown
   - This creates an immutable Raw Source Packet under `raw/sources/<opaque-id>/` and an associated Source Concept
   - The packet captures the original intent verbatim; the Source Concept is the reader-visible curation entry

3. **Decompose into atomic requirements**
   - Break the clarified concept into the smallest meaningful units of functionality
   - Each requirement should represent one independently verifiable behavior
   - For each atomic requirement, call `wiki_ensure_page(type="requirement", title="...", content="...")` where content includes:
     - `type: requirement` and `status: draft` in frontmatter
     - A clear `## Description` section
     - `## Acceptance Criteria` as a checkbox list (the threshold for "done")
     - `source_id` linking back to the source capture
     - `depends_on` linking to any prerequisite requirements
     - standard file-relative Markdown links ending in `.md` to relevant Concepts
   - Set priority based on user input: `p0` (blocking), `p1` (critical), `p2` (important), `p3` (nice-to-have)

4. **Cross-link and finalize**
   - Ensure each Requirement Concept has appropriate standard Markdown links to related Concepts
   - Change referenced Concepts only through controlled tools
   - Report the results: how many requirements created, their priorities, and the source capture ID

**Rules:**
- One atomic requirement per `wiki_ensure_page` call — each must be independently testable
- Always capture the clarified concept first via `wiki_capture_source` before decomposing
- Requirements live in `wiki/requirements/` as Concepts and change only through the Bundle Mutation seam
- Use status values: `draft` → `clarified` → `active` → `implemented` → `deferred` → `rejected`
- Use priority values: `p0` (blocking), `p1` (critical), `p2` (important), `p3` (nice-to-have)
- Do not create requirements in `raw/` — that layer is for external source artifacts only
