# 03 — Support complete multi-file Bundle Mutations

**What to build:** Let users safely evolve a bundle with atomic Concept moves, renames, deletions, relationship updates, and Bundle asset changes. A requested change must either become one complete, valid bundle revision or leave canonical authority unchanged.

**Blocked by:** 02 — Implement the Bundle Mutation core and Reserved Documents.

**Status:** ready-for-agent

- [ ] Support declared multi-file change sets containing Concept creation, replacement, move, rename, deletion, Bundle asset writes, and required Reserved Document materialization.
- [ ] Treat a move or rename as a Concept ID change and update every project-owned incoming Canonical Concept Link in the same mutation, or reject the operation before publication.
- [ ] Emit controlled Concept links as standard Markdown links with file-relative `.md` destinations while retaining labels and valid fragments.
- [ ] Preserve unrelated Concept bytes and Concept Timestamps when they have no Meaningful Knowledge Change; update timestamps when identity, relationships, provenance, status, description, or asserted knowledge changes.
- [ ] Treat Bundle assets as opaque distributed bytes while enforcing the same containment, declared-change-set, revision, idempotency, and recovery rules.
- [ ] Reject absolute targets, traversal outside the bundle, symbolic-link escapes, ambiguous Concept IDs, case-sensitive identity collisions, and changes that would create invalid controlled Concepts.
- [ ] Recompute and atomically publish all affected Navigation Indexes and the root update log as part of the one revision.
- [ ] Ensure stale revisions, validation failures, publication interruptions, and postcondition failures never report partial success or expose a partially moved bundle to controlled readers.
- [ ] Verify nested moves, incoming links from multiple directories, fragments, self-links, deletes, asset changes, path attacks, concurrent mutations, and retry recovery with automated tests.
