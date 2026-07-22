# 08 — Unify write adapters and complete the Native OKF cutover

**What to build:** Deliver Native OKF support consistently through Pi Extension and MCP, remove the superseded canonical writers, and make compatibility claims testable and precisely scoped. Users should receive the same canonical result and conflict semantics regardless of the adapter they use.

**Blocked by:** 03 — Support complete multi-file Bundle Mutations; 04 — Implement the controlled Source Concept lifecycle; 05 — Migrate all non-source Concept producer workflows; 06 — Rebuild all Private Projections against Bundle Revision; 07 — Reconcile external bundle edits without inventing history.

**Status:** ready-for-agent

- [ ] Route semantically equivalent Pi Extension and MCP operations through the same application-layer operation and Bundle Mutation implementation rather than adapter-specific canonical writers.
- [ ] Return equivalent validation diagnostics, canonical outcomes, Concept Timestamps, provenance, idempotency behavior, concurrency conflicts, Bundle Revisions, and canonical/private-only/no-op result classifications across adapters.
- [ ] Block controlled direct edits to generated Reserved Documents and direct canonical writes that bypass the mutation boundary while preserving legitimate external-edit detection and reconciliation.
- [ ] Remove the old direct Concept writers, wikilink output paths, raw-regex relationship authority, private metadata indexes/logs as bundle authority, and producer-specific rebuild behavior after all callers have migrated.
- [ ] Ensure the canonical distributable boundary is exactly the editable bundle root and that any Bundle Snapshot is a byte-preserving copy or archive with no inferred metadata, rewritten links, or second authority.
- [ ] Validate the final bundle end to end against the pinned OKF v0.1 Draft commit and separately against every applicable Native OKF Contract invariant.
- [ ] Report reference compatibility per named operation and pinned reference-tool revision, including document parse, document write validation, index generation, graph extraction, or viewer navigation where tested; never emit an unqualified “Google-compatible” claim.
- [ ] Ensure warnings or failures in one profile do not alter another profile’s result and unknown OKF versions are handled best-effort with an explicit outside-profile diagnostic.
- [ ] Update user-facing architecture, commands, API, configuration, linking guidance, compatibility language, and examples to use the normative domain vocabulary and avoid presenting private artifacts as bundle content.
- [ ] Add cross-adapter and end-to-end regression tests proving canonical byte equivalence, idempotent retries, stale-write conflicts, projection freshness, Reserved Document convergence, accurate support claims, and byte-preserving snapshots.
- [ ] Keep import of arbitrary third-party bundles, legacy-vault migration, transformed exports, hosted services, and unpinned future compatibility explicitly out of scope.
