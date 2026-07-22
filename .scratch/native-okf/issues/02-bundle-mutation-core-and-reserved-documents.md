# 02 — Implement the Bundle Mutation core and Reserved Documents

**What to build:** Let users initialize a native OKF bundle and create or update a Concept through one recoverable, concurrency-safe mutation boundary. Every successful canonical state must have deterministic Navigation Indexes and a reader-facing root update log, while retries and failures remain safe.

**Blocked by:** 01 — Establish Native OKF semantic reading and layered validation.

**Status:** ready-for-agent

- [ ] Bind every operation to one stable, non-sensitive Vault Identity before side effects and scope each Mutation Identity to that vault.
- [ ] Maintain a stable monotonically advancing Bundle Revision that advances exactly once for a successful canonical commit and not for failures, no-ops, retries, or private-only work.
- [ ] Reject reuse of a Mutation Identity for different intent, return or finish the same logical result for an identical retry, and enforce revision preconditions against stale concurrent writers.
- [ ] Validate a mutation’s complete intended change set and all bundle-wide path, content, provenance, revision, and reserved-document preconditions before publication.
- [ ] Stage canonical outputs and publish them atomically from controlled readers’ perspective, or recover without reporting partial success after interruption.
- [ ] Initialize a bundle with a root Navigation Index declaring `okf_version: "0.1"` and exactly one frontmatter-free root update log; never create a nested log.
- [ ] Create and replace Concepts only when the four required core fields are truthful non-empty scalar strings and all unowned YAML metadata can be semantically preserved.
- [ ] Update the Concept Timestamp for a Meaningful Knowledge Change, preserve it for established semantically equivalent formatting or serialization, and conservatively treat uncertain equivalence as meaningful.
- [ ] Deterministically materialize the complete progressive-disclosure Navigation Index tree, grouped by stored `type`, containing stored descriptions and links to immediate Concepts and populated child indexes, while removing stale generated indexes.
- [ ] Deterministically render committed bundle history under newest-first ISO date headings without runtime traces, and make unchanged index/log materialization byte-idempotent without advancing revision.
- [ ] Detect missing, extra, or byte-divergent Reserved Documents as drift; overwrite only a known trusted generated preimage and report an external-edit conflict for unrecognized bytes.
- [ ] Validate all postconditions after a successful commit, including whole-bundle validity and exact Reserved Document state.
- [ ] Demonstrate initialization, meaningful and formatting-only updates, unknown YAML preservation, stale writers, idempotent retries, no-ops, interrupted recovery, deterministic indexes, and deterministic logs with automated tests.
