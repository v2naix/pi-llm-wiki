# pi-llm-wiki Knowledge Bundle

> **Supporting vocabulary:** The final normative contract is [`docs/specifications/native-okf.md`](docs/specifications/native-okf.md). If this vocabulary context conflicts with that specification, the specification prevails.

This context defines the language used to describe pi-llm-wiki’s native Open Knowledge Format support and its compatibility boundaries.

## Language

**Canonical Knowledge Bundle**:
The complete distributable OKF bundle rooted at `.llm-wiki/wiki/`; its on-disk editable form is the authoritative knowledge representation. The surrounding `.llm-wiki/` directory is a private vault container, not part of the bundle.
_Avoid_: vault, export, `.llm-wiki/`

**Private Vault Layer**:
Any state within `.llm-wiki/` but outside `wiki/`, including raw evidence, generated metadata, configuration, templates, outputs, and runtime state. It may support pi-llm-wiki operations but is neither distributed with nor required to understand the Canonical Knowledge Bundle.
_Avoid_: bundle metadata, OKF sidecar

**Source Concept**:
The single editable Concept that represents one captured source for Knowledge Bundle readers. It is permanently associated with exactly one Raw Source Packet but is a mutable catalog entry and synthesis, not the original evidence or its complete substitute; moving, renaming, deleting, or explicitly restoring it never reassigns that association. A third-party source-like Concept without this project-owned provenance association is not a Source Concept in this narrower sense.
_Avoid_: source packet, raw source, evidence copy

**Raw Source Packet**:
The immutable evidence record created by one capture and held in the Private Vault Layer. A packet may have at most one live Source Concept, remains permanently reserved to that Concept's provenance identity if the Concept is deleted, and is never required to understand or navigate the Canonical Knowledge Bundle.
_Avoid_: source page, Source Concept, bundle source

**Raw Source Identifier**:
The stable, opaque identifier that permanently associates a Source Concept with its Raw Source Packet. It may be exposed in project-namespaced Concept metadata, but it is neither a URI nor a private path and does not promise that a bundle consumer can retrieve the packet.
_Avoid_: raw path, packet URI, source link

**Upstream Resource URI**:
A public, portable, disclosure-safe URI for the resource represented by a Source Concept. It identifies where the upstream resource can be found, not the Source Concept or Raw Source Packet, and makes no claim that later content at the URI is unchanged. Secrets, private-network locations, local inputs, redirects, tracking data, and uncertain capture details remain private; when no safe stable URI is known, none is fabricated.
_Avoid_: raw path, packet URI, provenance proof

**Source Provenance Notice**:
The machine-maintained, human-visible statement in a Source Concept that distinguishes its editable synthesis from original evidence and presents its reader-facing provenance without private paths. It communicates curation state, capture time, optional Upstream Resource URI, and that the Raw Source Packet is not part of the Canonical Knowledge Bundle.
_Avoid_: raw evidence, frontmatter-only provenance, source disclaimer

**Source Curation State**:
The stable, reader-facing state of a Source Concept: `captured` when it is an honest pending catalog entry, `synthesized` after a grounded synthesis has been committed, or `blocked` when curation requires intervention. It records durable knowledge state rather than queue, retry, extractor, or other runtime details; `synthesized` does not claim completeness or freedom from later human editing.
_Avoid_: job status, extraction status, source quality

**Source Capture Timestamp**:
The immutable UTC time when a Raw Source Packet was successfully established, optionally exposed as project-namespaced Source Concept metadata. It is distinct from the Concept Timestamp and from the upstream resource's publication, modification, or event time, and is never inferred from filesystem metadata or an unverified external bundle.
_Avoid_: Concept Timestamp, publication date, source event time

**Bundle Snapshot**:
A byte-preserving copy or archive of a Canonical Knowledge Bundle made for distribution, without export-time transformation. It is an independent snapshot, not a synchronized replica or second authority.
_Avoid_: OKF export, derived bundle

**Reserved Document**:
An OKF-defined structural Markdown document whose exact basename is `index.md` or `log.md`. It describes navigation or change history rather than a knowledge Concept and is therefore never part of the Concept set.
_Avoid_: Concept, generated Concept, knowledge page

**Navigation Index**:
A system-authoritative `index.md` Reserved Document derived from the Concepts beneath its directory to provide progressive bundle navigation. The root Navigation Index also carries the bundle's authoritative OKF version declaration; editorial knowledge belongs in Concepts, not in an index.
_Avoid_: index Concept, editable contents page, search document

**Index Materialization**:
The deterministic derivation and convergence of the complete Navigation Index tree from the valid Concept tree. It creates, replaces, or removes indexes to match that derived state without changing Concepts or inventing missing Concept metadata.
_Avoid_: metadata inference, index synthesis, recursive rebuild

**Navigation Index Drift**:
A missing, extra, or byte-divergent Navigation Index relative to the deterministically derived index state. Drift is a conflict when the divergent bytes cannot be proven to be a trusted system-generated preimage; it is never permission to overwrite external edits silently.
_Avoid_: stale Concept, harmless formatting, automatic repair

**OKF Conformance Profile**:
The normative OKF requirements against which a Knowledge Bundle is judged, identified by both a public specification version and a pinned upstream commit. The version names the compatibility target; the commit fixes the exact testable text.
_Avoid_: latest OKF, reference validator profile

**Concept Write**:
A controlled creation, replacement, move, or deletion of one Concept within the Canonical Knowledge Bundle. It is always one component of a Bundle Mutation and must satisfy the Concept Write Contract.
_Avoid_: file write, page save

**Concept Timestamp**:
The UTC time at which the Concept’s most recent Meaningful Knowledge Change was successfully committed to the Canonical Knowledge Bundle. It is not the source event time, capture time, model generation time, filesystem mtime, or a historical fact’s effective time.
_Avoid_: modified time, source time, observed time

**Meaningful Knowledge Change**:
A committed change that alters what a reader or knowledge consumer can learn from a Concept, including its asserted content, interpretation, status, relationships, provenance, identity, or standard descriptive metadata. Semantically equivalent serialization and formatting are excluded; when equivalence cannot be established, the change is treated conservatively as meaningful.
_Avoid_: file modification, byte change

**Concept Reaffirmation**:
An explicit, controlled confirmation that a Concept’s current knowledge remains valid when its true previous timestamp cannot be established. The confirmation is itself a Meaningful Knowledge Change and gives the Concept a new trustworthy timestamp without pretending to recover unknown history.
_Avoid_: timestamp repair, touch, inferred timestamp

**Bundle Asset Write**:
A controlled creation, replacement, move, or deletion of a non-Markdown resource in the Canonical Knowledge Bundle. It treats the asset as opaque bytes while applying bundle path, precondition, and change-set rules.
_Avoid_: metadata write, sidecar write

**Bundle Mutation**:
Any controlled operation that changes bytes in the Canonical Knowledge Bundle, including Concept Writes, Bundle Asset Writes, and reserved-document materialization. It commits one declared change set under bundle-wide preconditions and postconditions.
_Avoid_: metadata rebuild, direct write

**Bundle Revision**:
The stable, monotonically advancing identity of one successfully committed Canonical Knowledge Bundle state. It coordinates mutation preconditions and projection freshness but is not Concept metadata or knowledge content.
_Avoid_: file version, event timestamp, Git commit

**Mutation Identity**:
The stable idempotency identity of one Bundle Mutation request across retries, recovery, and response loss. Reusing it never creates a second logical commit, and a different intent cannot assume the same identity.
_Avoid_: Bundle Revision, event ID, retry attempt

**Private Projection**:
A rebuildable view in the Private Vault Layer, such as a registry, backlink map, search index, activity view, or embedding store. Its declared source revision or content identity determines freshness; it is never authority for a canonical commit.
_Avoid_: canonical metadata, bundle state, commit proof

**External Reconciliation**:
The controlled recognition of changes made outside the project write boundary, comparing them with the last trusted canonical baseline and admitting valid observed changes into a new Bundle Revision without inventing their original time or transaction boundary.
_Avoid_: external transaction, automatic repair, silent adoption

**Native OKF Contract**:
The project’s stricter, non-conflicting requirements for bundles created or mutated by pi-llm-wiki. It supplements but never overrides the OKF Conformance Profile.
_Avoid_: OKF conformance, reference compatibility

**Reference Tool Compatibility Profile**:
A version-pinned description of interoperability with one specific reference tool and operation. It is observational and never overrides OKF conformance or the Native OKF Contract.
_Avoid_: OKF conformance, Google compatibility

**Native OKF Support**:
A claim that the canonical Knowledge Bundle conforms to the project’s explicitly declared and version-pinned OKF Conformance Profile. It does not imply compliance with the stricter Native OKF Contract or compatibility with any particular reference tool.
_Avoid_: reference-compatible, Google-compatible

**YAML Parsing Profile**:
The project-owned safe YAML 1.2 subset accepted for Concept frontmatter: one document with a mapping root, standard safe values and no duplicate keys, custom tags, merge keys, alias cycles, or unbounded structures.
_Avoid_: full YAML, whatever the parser accepts, PyYAML-compatible YAML

**Semantic YAML Preservation**:
Equality of unowned frontmatter metadata after normalization to the YAML Parsing Profile’s value tree, including exact large integers but excluding comments, key order, styles, anchors, and aliases as authored.
_Avoid_: byte preservation, formatting preservation, best-effort round-trip

**Canonical Concept Link**:
A standard Markdown link whose destination resolves to a Concept in the same Canonical Knowledge Bundle. Both file-relative and bundle-root-relative targets are accepted; controlled writers emit file-relative targets with the `.md` suffix.
_Avoid_: wikilink, filesystem path, reference edge

**Link Occurrence**:
One source-positioned Markdown link instance, retaining its label, original destination, normalized target, fragment, target classification, and citation context.
_Avoid_: graph edge, backlink

**Concept Relationship**:
The directed, untyped source–target relationship obtained by deduplicating valid Canonical Concept Link occurrences between the same two Concepts.
_Avoid_: citation, link occurrence, typed edge

**Controlled Write Adapter**:
A public interaction surface, such as the Pi extension or MCP, that may expose its own subset and protocol shape of project write capabilities while submitting every canonical change through the same mutation semantics. Two adapters need not offer identical operations, but equivalent operations cannot differ in validation, canonical outcome, timestamp, provenance, idempotency, concurrency, or result classification.
_Avoid_: independent writer, API parity, mutation boundary

**Source Capture Operation**:
The recoverable, idempotent operation that first establishes one complete Raw Source Packet and then commits its associated Source Concept. It reports committed success only after both stages complete; an established packet whose Concept has not committed is retained as private recovery state and resumed under the same Mutation Identity rather than captured again.
_Avoid_: cross-layer filesystem transaction, packet write, Concept Write

**Vault Identity**:
The stable, non-sensitive identity of the one Private Vault Layer and Canonical Knowledge Bundle selected for an operation before side effects begin. Discovery mechanisms may differ by adapter, but an operation never changes vault because cwd, environment, or session state changes, and its Mutation Identity is scoped to this identity.
_Avoid_: vault path, current directory, bundle revision

**Private Projection Operation**:
A private-only derivation that atomically publishes one projection generation for a declared source Bundle Revision without changing canonical bytes, Concept Timestamps, or Bundle Revision.
_Avoid_: Bundle Mutation, canonical rebuild, metadata commit

**Private Administrative Operation**:
An idempotent private-only change to configuration, task settings, recovery materials, annotations, or private packets. Its result explicitly reports private-only effects and never implies a canonical commit.
_Avoid_: Bundle Mutation, projection rebuild, activity event
