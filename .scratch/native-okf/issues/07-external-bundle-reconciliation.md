# 07 — Reconcile external bundle edits without inventing history

**What to build:** Let users edit the Canonical Knowledge Bundle with ordinary editors and then deliberately reconcile those bytes with project authority. The system must admit valid knowledge, request explicit reaffirmation when needed, or report conflicts without pretending external edits were controlled transactions.

**Blocked by:** 03 — Support complete multi-file Bundle Mutations.

**Status:** ready-for-agent

- [ ] Maintain the trusted canonical baseline needed to compare observed bundle bytes with the last committed Bundle Revision.
- [ ] Diagnose external Concept, asset, and Reserved Document additions, modifications, moves, and deletions without changing authority during inspection.
- [ ] Admit a valid observed external change as exactly one new Bundle Revision without inventing its original transaction boundary or Mutation Identity.
- [ ] Refuse to infer missing historical Concept Timestamps from filesystem metadata, source times, event times, model runs, or exported artifacts.
- [ ] Offer explicit Concept Reaffirmation when current externally authored knowledge can be confirmed but its prior timestamp is not trustworthy; treat reaffirmation itself as a Meaningful Knowledge Change.
- [ ] Preserve valid unknown YAML semantics and reject reconciliation before publication when safe round-trip or bundle-wide postconditions cannot be guaranteed.
- [ ] Restore a divergent Reserved Document automatically only when its current bytes are a proven trusted generated preimage; otherwise report an external-edit conflict without overwriting it.
- [ ] Reconcile valid multi-file observations without claiming an unknowable original grouping, and require explicit resolution where identity, provenance, links, or moves are ambiguous.
- [ ] Re-materialize Reserved Documents and validate all postconditions as part of an admitted reconciliation commit.
- [ ] Cover valid admission, invalid external YAML, missing timestamps, reaffirmation, unknown reserved edits, trusted preimages, ambiguous moves, provenance conflicts, stale baselines, and no-op reconciliation with automated tests.
