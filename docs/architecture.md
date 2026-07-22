# Architecture

## Native OKF boundaries

A vault has two authority layers:

```text
WIKI_ROOT/
└── .llm-wiki/                         # Private Vault Layer (not distributed)
    ├── config.json
    ├── raw/sources/<opaque-id>/        # immutable Raw Source Packets
    ├── raw/trajectories/TRJ-*/         # private trajectory evidence
    ├── meta/                           # rebuildable Private Projections + mutation state
    ├── outputs/                        # private generated reports
    └── wiki/                           # Canonical Knowledge Bundle (distribution root)
        ├── index.md                    # generated root Navigation Index
        ├── log.md                      # generated root update log
        ├── sources/*.md                # Source Concepts
        ├── entities/*.md               # Concepts
        ├── concepts/*.md               # Concepts
        └── assets/*                     # opaque Bundle assets
```

`.llm-wiki/wiki/` is the editable, authoritative, distributable OKF bundle. A Bundle Snapshot is only a byte-preserving copy of that directory; there is no transformed export or second bundle authority. Configuration, Raw Source Packets, registries, backlinks, embeddings, recovery data, events, and reports remain in the Private Vault Layer.

## Controlled writes

Pi Extension and MCP are **Controlled Write Adapters**. Equivalent operations submit one application-layer operation, which applies one shared Bundle Mutation implementation. Every canonical request carries a Mutation Identity and expected Bundle Revision. A successful commit advances the revision exactly once; retries return the original result, stale writes conflict, and no-ops do not claim a commit.

Direct Pi `write` or `edit` calls under `.llm-wiki/wiki/` are blocked. Human or third-party editor changes are still observable on disk and must be deliberately admitted with External Reconciliation. Generated Reserved Documents (`index.md` and `log.md` at any depth) are never directly editable Concepts.

After canonical publication, registry, backlink, search, recall, and embedding Private Projections are rebuilt from observable bundle bytes and declare their source Bundle Revision/content identity. They are not canonical write authority.

## Concepts and links

Every controlled Concept stores truthful `type`, `title`, `description`, and UTC `timestamp` fields at write time. Controlled writers emit standard file-relative Markdown links ending in `.md`:

```markdown
[Transformer](../concepts/transformer.md)
```

Wikilinks are not canonical output. Parsed Markdown links—not raw regexes—define Link Occurrences and Concept Relationships. Private Raw Source Packet or trajectory paths must not appear as Concept links or citations.

## Source lifecycle

A Source Capture Operation first establishes one complete immutable Raw Source Packet, then commits one reader-visible Source Concept. The Concept exposes an opaque Raw Source Identifier and disclosure-safe provenance notice, never a private packet path. Its stable Source Curation State is `captured`, `synthesized`, or `blocked`.

Grounded ingestion commits the Source Concept update plus related entity/topic Concepts in one Bundle Mutation. Packet creation without Concept publication is retained as private recovery state and resumed under the same Mutation Identity.

## Validation and support claims

Native OKF Support targets OKF v0.1 Draft at specification commit `ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a`. Validation reports these independent profiles:

- pinned OKF Conformance Profile;
- Native OKF Contract; and
- each tested reference-tool operation at `knowledge-catalog` revision `d44368c15e38e7c92481c5992e4f9b5b421a801d`: document parse, document write validation, index generation, graph extraction, or viewer navigation.

A warning or failure in one profile does not alter another profile. Unknown declared OKF versions are consumed best-effort with an explicit outside-profile diagnostic. The project does not make an unqualified “Google-compatible” claim.

## Vault resolution

Project vault discovery walks upward from the current directory. When no project vault exists, `WIKI_HOME` or the user home directory selects the personal vault. The vault is resolved before operation side effects begin and remains fixed for that operation.

## Out of scope

Arbitrary third-party bundle import, legacy-vault migration into Native OKF, transformed exports, hosted services, and compatibility with unpinned future OKF or reference-tool revisions are outside the Native OKF cutover.
