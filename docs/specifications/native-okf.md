# Native Open Knowledge Format Support Specification

**Status:** Final, normative  
**Applies to:** pi-llm-wiki bundles created or mutated under this contract  
**OKF baseline:** Open Knowledge Format 0.1 Draft, pinned to [`ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a`](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md)  
**Reference-tool baseline:** Google `knowledge-catalog` reference agent, pinned to [`d44368c15e38e7c92481c5992e4f9b5b421a801d`](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf)

## 1. Purpose and normative language

This document is the single authoritative specification for native OKF support in pi-llm-wiki. It defines the canonical bundle boundary, the project-owned producer contract, mutation and provenance semantics, reserved documents, validation profiles, and the limits of compatibility claims.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative. Requirements attributed to “OKF v0.1” come from the pinned public specification. Requirements attributed to the “Native OKF Contract” are stricter project requirements and do not redefine upstream OKF conformance.

If this document conflicts with earlier plans, feasibility assessments, research notes, examples, prompts, or implementation documentation, this document takes precedence. Research documents remain evidence about pinned upstream behavior; they are not normative product specifications.

## 2. Scope and architecture

### 2.1 Canonical Knowledge Bundle

The editable directory `.llm-wiki/wiki/` is the **Canonical Knowledge Bundle**. Its on-disk contents are the authoritative knowledge representation and the distributable OKF bundle.

The product MUST NOT create a transformed OKF export as a second authority. Distribution MAY create a byte-preserving **Bundle Snapshot**, such as a copy or archive, but MUST NOT infer metadata, rewrite links, or otherwise transform knowledge at snapshot time.

The surrounding `.llm-wiki/` directory is the **Private Vault Layer** and is not part of the OKF bundle. Raw evidence, configuration, templates, registries, backlinks, embeddings, event storage, recovery state, extraction artifacts, lint reports, and other operational data MUST remain outside the Canonical Knowledge Bundle unless they are intentionally represented as conforming Concepts or bundle assets.

The bundle root is therefore exactly `.llm-wiki/wiki/`, not `.llm-wiki/` and not an output directory.

### 2.2 Four ownership classes

Every managed artifact belongs to exactly one of these classes:

1. **Concepts:** editable knowledge documents inside the Canonical Knowledge Bundle.
2. **Reserved Documents:** system-authoritative `index.md` and `log.md` documents inside the bundle.
3. **Bundle assets:** non-Markdown resources intentionally distributed with the bundle.
4. **Private Vault Layer artifacts:** operational or evidentiary state outside the bundle.

A private Markdown artifact MUST NOT be placed under the bundle root merely for operational convenience, because every non-reserved `.md` there is an OKF Concept.

## 3. Compatibility and claim model

Compatibility MUST be reported in separate dimensions.

### 3.1 OKF Conformance Profile

The **OKF Conformance Profile** is OKF v0.1 Draft at the pinned specification commit above. Under that profile, a bundle is conformant when:

1. every non-reserved `.md` has parseable YAML frontmatter;
2. every such frontmatter has a non-empty `type`; and
3. every present `index.md` and `log.md` follows the applicable OKF reserved-document structure.

Missing optional metadata, unknown Concept types, unknown extension fields, broken internal links, or missing indexes MUST NOT by themselves cause an OKF-conformance failure.

### 3.2 Native OKF Contract

The **Native OKF Contract** is the stricter producer and mutation contract in this document. A pi-llm-wiki controlled write MUST satisfy it. A bundle can conform to upstream OKF while failing this stricter contract; validators MUST distinguish those outcomes.

The phrase **Native OKF Support** means that the Canonical Knowledge Bundle conforms to the declared, version-pinned OKF Conformance Profile. It MUST NOT be used to imply that an arbitrary externally edited bundle satisfies the Native OKF Contract or works with every reference-tool operation.

### 3.3 Reference Tool Compatibility Profile

Reference compatibility is observational and operation-specific. A result MUST name the pinned tool revision and operation, such as document parse, document write validation, index generation, graph extraction, or viewer navigation. The product MUST NOT use “Google-compatible” as an unqualified bundle-level claim.

Reference behavior MUST NOT override either upstream conformance or the Native OKF Contract. In particular:

- the reference document writer’s four truthy-key check is not an OKF v0.1 conformance oracle;
- the reference index generator is not the authority for this project’s index lifecycle;
- the reference visualizer’s restricted link regex and treatment of `log.md` are not this project’s link or Concept-discovery semantics.

### 3.4 Validation result shape

Validation MUST report at least:

- `okfConformance`: pass or fail against the pinned OKF Conformance Profile;
- `nativeContract`: pass or fail against this document when that judgment is applicable;
- `referenceCompatibility`: separate results for each tested pinned reference operation; and
- path-addressed errors and warnings that identify which profile produced each diagnostic.

A warning in one profile MUST NOT change another profile’s result.

## 4. Concept model and write contract

### 4.1 Identity and discovery

Every UTF-8 Markdown file under the bundle root whose exact basename is not `index.md` or `log.md` is a **Concept**. The two reserved basenames apply at every directory depth.

A Concept ID is its bundle-relative path with the final `.md` suffix removed and `/` as the logical separator. Concept IDs are folder-qualified and case-sensitive at the contract level. A controlled writer MUST reject paths that are absolute, escape the bundle, resolve through a symbolic link outside the bundle, or ambiguously normalize to another Concept ID.

A move or rename changes the Concept ID. Controlled moves MUST update project-owned incoming links as one declared Bundle Mutation or reject the operation. They MUST NOT silently leave the bundle in a partially moved state.

### 4.2 Required frontmatter

Every Concept produced or modified by a controlled writer MUST begin with YAML frontmatter and contain these four non-empty scalar strings:

```yaml
type: concept
title: Example title
description: A concise and truthful description of the knowledge in this Concept.
timestamp: "2026-07-22T00:00:00Z"
```

The fields have these meanings:

- `type`: an open, producer-defined, descriptive Concept type. There is no central type registry.
- `title`: the human-readable identity of the Concept. It MUST NOT be inferred later from a filename to repair a controlled write.
- `description`: a concise, truthful description suitable for navigation and retrieval. It MUST NOT be a placeholder or a later guess from arbitrary body text.
- `timestamp`: the **Concept Timestamp**, expressed as an ISO 8601 UTC datetime, recording the most recent committed Meaningful Knowledge Change.

`resource` MAY contain an **Upstream Resource URI** only when a public, portable, disclosure-safe canonical URI is known. It MUST NOT expose a private path, secret, private-network location, redirect artifact, tracking detail, or Raw Source Packet location. `tags` MAY be present. Optional values MUST NOT be fabricated.

Producer-owned extension fields MAY represent status, category, domain, source identity, trajectory references, or other project semantics. Unknown fields MUST be accepted within the YAML Parsing Profile and semantically preserved by read-modify-write operations.

### 4.3 Description responsibility

Metadata is captured at knowledge-write time, not repaired at export or indexing time.

A page-producing workflow MUST possess sufficient structured information to supply a truthful description before persistence. Ingestion synthesis MUST provide descriptions for the Source Concepts, entity Concepts, and topic Concepts it creates or materially updates. Page creation, retrospective capture, observation capture, requirements, skills, and cases MUST likewise provide the four core fields.

A newly captured but not yet synthesized Source Concept MAY use a deterministic pending description that identifies the source and explicitly states that synthesis is pending. It MUST NOT claim to summarize content that has not been read. Successful synthesis MUST replace the pending description and update the Concept Timestamp.

### 4.4 Concept Timestamp

A **Meaningful Knowledge Change** is a committed change to what a reader or consumer can learn from a Concept, including asserted content, interpretation, status, relationships, provenance, identity, or standard descriptive metadata.

A controlled writer MUST update `timestamp` when it commits a Meaningful Knowledge Change and MUST preserve it for a semantically equivalent serialization or formatting-only change. If semantic equivalence cannot be established, the change MUST be treated conservatively as meaningful.

A Concept Timestamp MUST NOT be inferred from filesystem mtime, source publication time, source capture time, model execution time, event time, or an exported artifact.

When an externally authored Concept has no trustworthy previous timestamp, the system MUST NOT fabricate its history. A controlled **Concept Reaffirmation** MAY explicitly confirm the current knowledge and assign the reaffirmation commit time. That confirmation is itself a Meaningful Knowledge Change and MUST be represented as such.

### 4.5 YAML Parsing Profile

Controlled readers and writers MUST use the project’s safe YAML 1.2 profile:

- exactly one YAML document;
- a mapping at the frontmatter root;
- standard safe scalar, sequence, and mapping values;
- no duplicate mapping keys;
- no custom tags;
- no merge keys;
- no cyclic aliases or unbounded alias/structure expansion; and
- explicit implementation limits sufficient to prevent resource exhaustion.

The opening and closing delimiters MUST each be an exact, standalone `---` line. A UTF-8 BOM or content before the opening delimiter is not accepted for a controlled Concept write. A delimiter-like line inside a YAML block scalar MUST be interpreted according to YAML structure, not by a line-stripping delimiter search.

Core fields MUST be strings after parsing; YAML truthiness is not validation. `timestamp` MUST parse as the required UTC datetime form.

**Semantic YAML Preservation** means equality of all unowned metadata after normalization to this profile’s value tree, including exact large integers. It does not promise preservation of comments, key order, quoting, scalar style, anchors, aliases, whitespace, or original lexical forms. A controlled read-modify-write MUST preserve unknown keys at this semantic level or reject the write before changing the Concept.

## 5. Source provenance

### 5.1 Source Concept and Raw Source Packet

A **Source Concept** is the single editable Concept representing one captured source to bundle readers. It is a mutable catalog entry and synthesis, not original evidence and not a complete substitute for that evidence.

A **Raw Source Packet** is the immutable evidence record created by one capture and stored in the Private Vault Layer. It MUST NOT be moved into the bundle merely to satisfy native OKF support.

Each project-owned Source Concept is permanently associated with exactly one Raw Source Packet by a stable, opaque **Raw Source Identifier**. A packet MAY have at most one live Source Concept. Moving, renaming, deleting, or explicitly restoring that Concept MUST NOT reassign the packet to a different provenance identity. Deletion MUST NOT make the packet available for reuse. A third-party source-like Concept lacking this association is not a project-owned Source Concept.

The Raw Source Identifier MAY appear in project-namespaced metadata. It is not a URI, MUST NOT expose a private packet path, and MUST NOT promise bundle consumers access to private evidence.

### 5.2 Reader-visible provenance

Every project-owned Source Concept MUST contain a machine-maintained, human-visible **Source Provenance Notice**. The notice MUST distinguish the editable synthesis from original evidence and state:

- the Source Curation State;
- the Source Capture Timestamp;
- the Upstream Resource URI, when one is safely known; and
- that the Raw Source Packet is outside the Canonical Knowledge Bundle.

Frontmatter alone is insufficient for this notice.

The stable Source Curation States are:

- `captured`: an honest pending catalog entry;
- `synthesized`: a grounded synthesis has been committed; and
- `blocked`: curation requires intervention.

These values describe durable reader-facing knowledge state. They MUST NOT encode queue, retry, extractor, or other runtime state. `synthesized` MUST NOT be presented as a claim of completeness or immunity from later editing.

The **Source Capture Timestamp** is the immutable UTC time when the complete Raw Source Packet was successfully established. It is distinct from the Concept Timestamp and from upstream publication, modification, or event times. It MUST NOT be inferred from filesystem metadata or an unverified external bundle.

### 5.3 Capture operation

A Source Capture Operation is recoverable and idempotent. It MUST first establish one complete Raw Source Packet and then commit its associated Source Concept. It MUST report committed success only after both stages complete.

If packet creation succeeds but the Concept commit does not, the packet MUST be retained as private recovery state. A retry with the same Mutation Identity MUST resume that operation rather than recapture the source or create a second packet.

## 6. Markdown links, relationships, and citations

### 6.1 Canonical links

A **Canonical Concept Link** is a standard Markdown link whose destination resolves to a Concept in the same bundle. Controlled writers MUST emit file-relative destinations ending in `.md`. Controlled readers MUST accept both file-relative and bundle-root-relative destinations.

Obsidian wikilinks are not canonical output. Standard Markdown links remain usable in Obsidian, GitHub, and ordinary Markdown readers.

Link analysis MUST operate on parsed Markdown structure rather than raw-text regex matching. It MUST:

- include inline and reference-style links;
- exclude images, autolinks that are not Concept links, HTML-only links unless explicitly supported, and link-like text in code spans or fenced code blocks;
- resolve relative destinations against the source Concept directory and bundle-root destinations against the bundle root;
- URL-decode path components according to Markdown URL semantics before Concept resolution;
- normalize `.` and `..` while enforcing bundle containment;
- retain a valid fragment separately from the Concept target;
- classify external, out-of-bundle, broken, and valid internal targets separately; and
- never treat a private filesystem path as a Concept destination.

A **Link Occurrence** retains source position, label, original destination, normalized target, fragment, target classification, and whether it occurs in citation context.

A **Concept Relationship** is the directed, untyped source-target pair obtained by deduplicating valid Canonical Concept Link occurrences between two Concepts. Multiple occurrences and fragments MAY produce one relationship while remaining distinct occurrences. Self-links MAY remain occurrences but MUST NOT be presented as an inter-Concept relationship.

Broken internal links do not fail OKF conformance, but project lint MUST report them. External and out-of-bundle targets MUST NOT become Concept Relationships.

### 6.2 Citations

When external material supports claims in a Concept, the Concept SHOULD end with a `# Citations` section containing numbered standard Markdown links. A Citation MAY target an external URI or an appropriate source/reference Concept in the bundle.

Citation context MUST be derived from Markdown structure, not inferred from every relationship. General backlinks MUST be described as links or relationships, not “citations.” Private Raw Source Packet paths MUST NOT appear as citations.

## 7. Reserved Documents

The exact basenames `index.md` and `log.md` are Reserved Documents at every depth. They are never Concepts.

Reserved Documents MUST be excluded from Concept registries, search and recall results, embeddings, backlinks as source Concepts, page counts, orphan detection, and ordinary Concept lint. Reserved-document validation remains required. Controlled direct edits to generated Reserved Documents MUST be blocked; reconciliation rules in §8.5 apply to external changes.

### 7.1 Navigation Index

A system-authoritative `index.md` is a **Navigation Index**. The system MUST deterministically materialize a complete progressive-disclosure index tree for every directory containing Concepts directly or in descendants. It MUST remove indexes that no longer belong to that derived tree.

Each Navigation Index MUST:

- use ordinary Markdown headings and list links;
- enumerate immediate Concepts grouped by `type`;
- link to populated immediate child directories through their `index.md`;
- use relative links;
- include the stored `description` for every Concept entry;
- use deterministic grouping, ordering, escaping, and serialization; and
- contain no inferred or model-generated Concept metadata.

The root Navigation Index MUST declare `okf_version: "0.1"` in YAML frontmatter. Non-root indexes MUST have no frontmatter. The root version declaration is system authority and MUST survive every index materialization.

Directory descriptions MAY be omitted. If present, they MUST be deterministically derived from already authoritative metadata; index rebuilding MUST NOT call a model to invent them.

**Index Materialization** MUST converge: with unchanged valid Concepts and contract version, repeated materialization produces byte-identical index files, removes stale generated indexes, and does not alter Concepts or Concept Timestamps. Implementations SHOULD avoid rewriting byte-identical files.

A missing, extra, or byte-divergent index is **Navigation Index Drift**. Drift MAY be replaced automatically only when its current bytes are a known trusted system-generated preimage. Otherwise it is an external-edit conflict and MUST NOT be silently overwritten.

### 7.2 Root update log

The bundle MUST have one system-authoritative root `log.md`. Controlled writers MUST NOT create nested logs.

The root log MUST:

- contain no frontmatter;
- group entries under ISO 8601 `YYYY-MM-DD` headings;
- order date groups newest first;
- render entries deterministically from committed bundle mutation history; and
- remain a flat reader-facing history rather than a runtime trace.

Retry attempts, queue state, extraction internals, and private administrative activity MUST NOT appear as bundle changes. Materializing an unchanged log MUST be byte-idempotent and MUST NOT advance the Bundle Revision.

Like indexes, a divergent log MAY be replaced automatically only from a trusted generated preimage; otherwise the divergence requires External Reconciliation.

## 8. Bundle mutation and consistency

### 8.1 Mutation boundary

Every controlled change to canonical bytes is a **Bundle Mutation**. This includes Concept creation, replacement, move, and deletion; bundle asset writes; and Reserved Document materialization.

A Bundle Mutation MUST:

1. bind to one stable Vault Identity before side effects begin;
2. declare its complete intended change set;
3. validate bundle-wide path, revision, provenance, and content preconditions;
4. stage all canonical outputs before publication;
5. commit the change set atomically from the perspective of controlled readers, or use recoverable transaction semantics that never report partial success;
6. validate all postconditions, including reserved-document state; and
7. advance the Bundle Revision exactly once on successful canonical commit.

A failed or no-op operation MUST NOT claim a canonical commit or advance the Bundle Revision.

### 8.2 Bundle Revision and Mutation Identity

A **Bundle Revision** is the stable, monotonically advancing identity of one successfully committed canonical bundle state. It coordinates mutation preconditions and private projection freshness. It is not a Concept Timestamp, event timestamp, filesystem version, or Git commit.

Every Bundle Mutation request MUST have a stable **Mutation Identity** scoped to the Vault Identity. Retrying the same intent with the same identity MUST return or complete the same logical result without creating a second commit. Reusing an identity for different intent MUST be rejected.

Concurrent mutations MUST use revision preconditions. A stale writer MUST fail with a conflict or explicitly re-evaluate against the new revision; it MUST NOT silently overwrite intervening canonical changes.

### 8.3 Controlled Write Adapters

Pi extension and MCP surfaces are **Controlled Write Adapters**. They MAY expose different operation sets or protocol shapes, but equivalent operations MUST use the same mutation boundary and produce the same validation, canonical outcome, timestamp, provenance, idempotency, concurrency, and result classification.

No adapter may implement an independent canonical writer.

### 8.4 Private operations and projections

A **Private Projection** is a rebuildable view such as a registry, backlink map, search index, activity view, or embedding store. Each generation MUST declare its source Bundle Revision or equivalent canonical content identity. A projection MUST NOT be treated as authority for a canonical commit.

A Private Projection Operation MUST atomically publish one complete projection generation and MUST NOT change canonical bytes, Concept Timestamps, or Bundle Revision. Rebuilding projections MAY trigger a separately declared Reserved Document materialization only when canonical drift exists; it MUST NOT create a recursive rebuild loop.

A Private Administrative Operation changes only configuration, task settings, recovery materials, annotations, or private packets. It MUST be idempotent and its result MUST explicitly distinguish private-only effects from canonical commits.

### 8.5 External reconciliation

Direct human or external-tool edits can temporarily violate the Native OKF Contract. The system MUST diagnose them without pretending they were controlled transactions.

**External Reconciliation** compares observed bundle bytes with the last trusted canonical baseline and either:

- admits a valid observed change into one new Bundle Revision;
- requests explicit Concept Reaffirmation where historical timestamp truth cannot be established;
- reports conflicts or validation failures without changing authority; or
- restores only a Reserved Document whose divergent bytes are proven to be a trusted generated preimage.

External reconciliation MUST NOT invent the original transaction boundary, Mutation Identity, Concept Timestamp, or provenance. It MUST NOT silently overwrite unrecognized external edits to Reserved Documents.

## 9. Validation and operational invariants

Controlled Concept writes MUST be validated before persistence and rejected with actionable, path-specific diagnostics when invalid. Whole-bundle validation MUST inspect the bundle as an external consumer would rather than relying only on private registries or helper state.

At minimum, native validation covers:

- bundle boundary and path containment;
- Concept discovery and Concept IDs;
- YAML Parsing Profile and four core fields;
- Concept Timestamp format and controlled-write responsibility;
- Source Concept provenance invariants;
- Canonical Concept Link resolution and broken-link health;
- Reserved Document structure, completeness, deterministic bytes, and drift;
- separation of Concepts, assets, and private artifacts; and
- declared OKF and reference profile versions.

Unknown producer fields and unknown `type` values MUST NOT fail upstream OKF conformance. A controlled round-trip that cannot preserve unknown YAML semantics MUST fail before writing.

## 10. Versioning and upgrades

The root Navigation Index is the authoritative in-bundle declaration of target OKF version. The pinned upstream commit in this document fixes the exact conformance text used by the product even though the public label remains `0.1` Draft.

An upstream change MUST NOT silently alter validation or support claims. Adopting another upstream revision requires a deliberate specification update that:

1. pins the new public specification revision;
2. records semantic differences from the prior profile;
3. assesses whether the change is backward compatible for existing canonical bundles;
4. updates the Native OKF Contract where necessary without mislabeling project rules as upstream rules;
5. separately reassesses each claimed reference-tool operation; and
6. defines reconciliation or migration before controlled writers emit the new form.

Unknown declared OKF versions SHOULD be consumed best-effort as upstream requires, while validation reports that the version is outside the project’s pinned profile.

## 11. Out of scope

This specification does not define:

- a transformed OKF export, duplicate bundle, export freshness protocol, or bidirectional synchronization;
- import of arbitrary third-party OKF bundles;
- migration of existing user vaults;
- a central taxonomy or registry for `type`;
- replacement of immutable Raw Source Packets with OKF Concepts;
- publication of private registries, embeddings, events, recovery state, or extraction artifacts;
- automatic rewriting of manually authored prose solely to add citations;
- a hosted knowledge service, proprietary schema registry, Google Cloud dependency, BigQuery enrichment agent, or reference visualizer implementation; or
- compatibility guarantees for future OKF versions or unpinned reference-tool revisions.

A future requirement for import, legacy migration, or transformed publication requires a separate normative specification.

## 12. Normative precedence and supporting records

This file is the final product specification. The following documents are supporting records only:

- [`../research/okf-v0.1-normative-requirements.md`](../research/okf-v0.1-normative-requirements.md): pinned upstream OKF requirements and ambiguities;
- [`../research/okf-reference-document-validator.md`](../research/okf-reference-document-validator.md): reference document parser/writer observations;
- [`../research/okf-reference-index-generator.md`](../research/okf-reference-index-generator.md): reference index generator observations;
- `docs/research/okf-reference-visualizer.md`, when present on the relevant research branch: reference viewer observations; and
- [`../okf-feasibility.md`](../okf-feasibility.md): historical option assessment.

The superseded implementation plan at [`../plans/okf-native-spec.md`](../plans/okf-native-spec.md) is retained only as a pointer to this specification.
