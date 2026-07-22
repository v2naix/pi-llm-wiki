# 05 — Migrate all non-source Concept producer workflows

**What to build:** Ensure every project workflow that creates reader-visible knowledge—general pages, requirements, observations, retrospectives, skills, and cases—produces native OKF Concepts through the shared mutation boundary instead of writing Markdown independently.

**Blocked by:** 02 — Implement the Bundle Mutation core and Reserved Documents.

**Status:** ready-for-agent

- [ ] Inventory every controlled workflow that can create or modify Markdown under the bundle root and route each through the shared Bundle Mutation API.
- [ ] Require each workflow to possess and persist a truthful `type`, `title`, `description`, and UTC Concept Timestamp at knowledge-write time rather than repairing metadata during indexing or export.
- [ ] Preserve producer-owned extension metadata and semantically preserve unknown third-party YAML fields during every read-modify-write operation, or reject before changing bytes.
- [ ] Migrate general page and entity/topic/synthesis/analysis creation while retaining their user-visible behavior and ensuring all emitted internal links are canonical standard Markdown links.
- [ ] Migrate requirement creation and updates while treating status, priority, dependencies, traceability, and standard descriptions as Meaningful Knowledge Change when applicable.
- [ ] Migrate observation and retrospective capture with honest descriptions and timestamps without incorrectly treating lightweight captures as project-owned Source Concepts unless they have the required packet association.
- [ ] Keep trajectory evidence in the Private Vault Layer while creating conforming reader-visible skill and case Concepts with disclosure-safe provenance and canonical links.
- [ ] Ensure each workflow receives idempotency and revision semantics, advances the Bundle Revision once per successful canonical commit, and reports conflicts and private-only effects accurately.
- [ ] Remove workflow-specific index/log rebuilding from migrated producers; Reserved Documents must be postconditions of the shared mutation.
- [ ] Cover each producer family with end-to-end tests for valid metadata, timestamps, links, retries, concurrent conflicts, Reserved Document convergence, and absence of direct canonical writes.
