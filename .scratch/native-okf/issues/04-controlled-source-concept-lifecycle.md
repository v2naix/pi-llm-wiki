# 04 — Implement the controlled Source Concept lifecycle

**What to build:** Let users capture a URL, local file, or pasted text and immediately receive an honest reader-visible Source Concept backed by immutable private evidence. Later synthesis must atomically turn that pending entry into grounded bundle knowledge without duplicating evidence or leaking private details.

**Blocked by:** 02 — Implement the Bundle Mutation core and Reserved Documents.

**Status:** ready-for-agent

- [ ] Establish one complete immutable Raw Source Packet before committing its associated Source Concept, and report committed success only after both stages succeed.
- [ ] Permanently associate each project-owned Source Concept with exactly one packet through a stable opaque Raw Source Identifier; never expose the packet path or reuse the association after move, deletion, or explicit restoration.
- [ ] Resume recovery state under the same Mutation Identity when packet creation succeeded but Concept commit failed, without recapturing the source or creating another packet.
- [ ] Create a `captured` Source Concept with the four core fields, a deterministic pending description that does not pretend synthesis occurred, and a human-visible Source Provenance Notice.
- [ ] Include immutable Source Capture Timestamp, Source Curation State, optional disclosure-safe Upstream Resource URI, and a statement that raw evidence remains outside the bundle in the notice.
- [ ] Omit unsafe or uncertain resource values, including private/local paths, secrets, private-network locations, redirect artifacts, tracking details, and packet locations.
- [ ] Represent extraction or curation intervention as durable `blocked` knowledge state without exposing queue, retry, extractor, or runtime state as reader-facing curation state.
- [ ] Commit successful synthesis as one Bundle Mutation that replaces pending metadata, changes state to `synthesized`, updates the Source Concept Timestamp, and creates or materially updates related entity and topic Concepts with truthful descriptions.
- [ ] Produce standard file-relative Markdown links and appropriate citations without linking or citing private Raw Source Packet paths.
- [ ] Preserve the permanent provenance association across controlled Source Concept moves, deletions, and explicit restoration.
- [ ] Route URL, file, and text capture plus synthesis through the same lifecycle semantics and cover retries, failed packet completion, failed Concept commit, unsafe URIs, blocked curation, and atomic multi-Concept synthesis with automated tests.
