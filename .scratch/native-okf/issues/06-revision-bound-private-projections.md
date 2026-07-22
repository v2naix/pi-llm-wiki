# 06 — Rebuild all Private Projections against Bundle Revision

**What to build:** Let users search and navigate current knowledge through rebuildable private projections whose freshness is explicit. Registry, backlinks, recall, search, and embeddings must all agree on the same Concept boundary without becoming authority for canonical writes.

**Blocked by:** 01 — Establish Native OKF semantic reading and layered validation; 02 — Implement the Bundle Mutation core and Reserved Documents.

**Status:** ready-for-agent

- [ ] Build every projection from externally observable canonical bundle bytes and declare the exact source Bundle Revision or equivalent canonical content identity.
- [ ] Atomically publish one complete generation so readers see either the old or new projection, never a partially rebuilt mix.
- [ ] Populate the registry exclusively from Concepts and their stored metadata; do not fabricate titles, descriptions, created dates, types, or pages from filenames, Raw Source Packets, or runtime state.
- [ ] Build backlinks from parsed valid Canonical Concept Link occurrences and Concept Relationships rather than raw wikilink regexes.
- [ ] Exclude every Reserved Document from registry entries, backlink sources, recall/search results, embeddings, page counts, orphan detection, and ordinary Concept lint.
- [ ] Exclude Raw Source Packets, private trajectories, configuration, events, recovery data, generated reports, and Bundle assets from Concept projections.
- [ ] Make recall, layered recall, link-first retrieval, skill/case retrieval, and embeddings consume a coherent projection generation and expose or safely handle stale projection state.
- [ ] Ensure projection rebuilds never change canonical bytes, Concept Timestamps, or Bundle Revision; a separately declared Reserved Document materialization may run only for real canonical drift and must not recurse.
- [ ] Keep private administrative operations idempotent and classify their outcomes as private-only rather than canonical commits.
- [ ] Verify projection atomicity, freshness, exclusion rules, broken-link handling, nested Concepts, empty bundles, concurrent rebuild coalescing, and no canonical side effects with automated tests.
