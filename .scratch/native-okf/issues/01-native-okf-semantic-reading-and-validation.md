# 01 — Establish Native OKF semantic reading and layered validation

**What to build:** Let users inspect a Canonical Knowledge Bundle as an external consumer would and receive independent, path-addressed judgments for the pinned OKF profile, the stricter Native OKF Contract, and each declared reference-tool operation. The reader must use the project vocabulary consistently and provide the shared semantic model used by later mutation and projection work.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Discover every UTF-8 Markdown file below the bundle root as a Concept except files whose exact basename is `index.md` or `log.md`; classify non-Markdown files as Bundle assets and never inspect the surrounding Private Vault Layer as bundle content.
- [ ] Derive folder-qualified, case-sensitive Concept IDs with logical `/` separators, while diagnosing absolute paths, containment escapes, ambiguous normalization, and symbolic-link escapes.
- [ ] Parse Concept frontmatter with the safe YAML 1.2 profile: one mapping document, exact standalone delimiters, no BOM or prefix content, duplicate keys, custom tags, merge keys, cyclic aliases, or unbounded structures.
- [ ] Preserve exact scalar value semantics, including large integers, and validate core fields as non-empty strings with a UTC ISO 8601 Concept Timestamp where the Native OKF Contract applies.
- [ ] Parse Markdown structure to retain inline and reference-style Link Occurrences, source positions, labels, original destinations, fragments, citation context, and valid, broken, external, or out-of-bundle classifications.
- [ ] Resolve file-relative and bundle-root-relative Concept links after URL decoding and containment-safe normalization; derive deduplicated directed Concept Relationships without treating images, code, unsupported HTML, private paths, or self-links as inter-Concept relationships.
- [ ] Report broken links and stricter producer defects without turning them into upstream OKF-conformance failures when the pinned upstream profile permits them.
- [ ] Return independent `okfConformance`, `nativeContract`, and operation-specific `referenceCompatibility` results, with every error and warning identifying its profile and bundle-relative path.
- [ ] Cover malformed and adversarial YAML, nested reserved basenames, unknown Concept types and extension fields, fragments, encoded paths, reference links, code spans, fenced code, and profile independence with automated tests.
