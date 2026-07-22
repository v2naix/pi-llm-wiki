import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import {
  type Alias,
  type Document,
  type Pair,
  type Node as YamlNode,
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
} from "yaml";

export const OKF_PROFILE = {
  version: "0.1",
  revision: "ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a",
} as const;

export const REFERENCE_TOOL_PROFILE = {
  revision: "d44368c15e38e7c92481c5992e4f9b5b421a801d",
  operations: [
    "document-parse",
    "document-write-validation",
    "index-generation",
    "graph-extraction",
    "viewer-navigation",
  ],
} as const;

export type DiagnosticSeverity = "error" | "warning";
export type ValidationStatus = "pass" | "fail" | "not-applicable";
export type ReferenceOperation = (typeof REFERENCE_TOOL_PROFILE.operations)[number];
export type DiagnosticProfile =
  | "okf-conformance"
  | "native-contract"
  | `reference:${ReferenceOperation}`;

export interface Diagnostic {
  profile: DiagnosticProfile;
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  path: string;
  line?: number;
  column?: number;
}

export interface ValidationResult {
  status: ValidationStatus;
  version: string;
  revision: string;
  diagnostics: Diagnostic[];
}

export interface ReferenceCompatibilityResult extends ValidationResult {
  operation: ReferenceOperation;
}

export type YamlValue =
  | null
  | boolean
  | string
  | number
  | bigint
  | YamlValue[]
  | { [key: string]: YamlValue };

export interface SourcePosition {
  start: { line: number; column: number; offset?: number };
  end: { line: number; column: number; offset?: number };
}

export type LinkClassification = "valid" | "broken" | "external" | "out-of-bundle" | "bundle-asset";

export interface LinkOccurrence {
  label: string;
  originalDestination: string;
  normalizedTarget?: string;
  fragment?: string;
  classification: LinkClassification;
  citationContext: boolean;
  referenceLabel?: string;
  position: SourcePosition;
}

export interface Concept {
  id: string;
  path: string;
  metadata: { [key: string]: YamlValue } | null;
  body: string;
  links: LinkOccurrence[];
}

export interface BundleAsset {
  path: string;
}

export interface ReservedDocument {
  path: string;
  kind: "index" | "log";
}

export interface ConceptRelationship {
  source: string;
  target: string;
}

export interface KnowledgeBundleReadOptions {
  nativeContractApplicable?: boolean;
  referenceOperations?: readonly ReferenceOperation[];
  limits?: Partial<ReaderLimits>;
}

export interface KnowledgeBundleReadResult {
  root: string;
  concepts: Concept[];
  assets: BundleAsset[];
  reservedDocuments: ReservedDocument[];
  relationships: ConceptRelationship[];
  okfConformance: ValidationResult;
  nativeContract: ValidationResult;
  referenceCompatibility: ReferenceCompatibilityResult[];
}

interface ReaderLimits {
  maxFileBytes: number;
  maxYamlNodes: number;
  maxYamlDepth: number;
  maxAliases: number;
}

interface DiscoveredFile {
  absolutePath: string;
  path: string;
  kind: "concept" | "asset" | "index" | "log";
}

interface ParsedFrontmatter {
  metadata: Concept["metadata"];
  body: string;
  bodyOffset: number;
  bodyStartLine: number;
  errors: ParseProblem[];
}

interface ParseProblem {
  code: string;
  message: string;
  line?: number;
  column?: number;
  upstreamFailure: boolean;
}

interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  depth?: number;
  value?: string;
  url?: string;
  identifier?: string;
  label?: string;
  position?: SourcePosition;
}

const DEFAULT_LIMITS: ReaderLimits = {
  maxFileBytes: 2 * 1024 * 1024,
  maxYamlNodes: 10_000,
  maxYamlDepth: 100,
  maxAliases: 100,
};

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function safeLimits(overrides: Partial<ReaderLimits> | undefined): ReaderLimits {
  const bounded = (value: number | undefined, maximum: number): number =>
    value !== undefined && Number.isFinite(value) && value > 0
      ? Math.min(Math.floor(value), maximum)
      : maximum;
  return {
    maxFileBytes: bounded(overrides?.maxFileBytes, DEFAULT_LIMITS.maxFileBytes),
    maxYamlNodes: bounded(overrides?.maxYamlNodes, DEFAULT_LIMITS.maxYamlNodes),
    maxYamlDepth: bounded(overrides?.maxYamlDepth, DEFAULT_LIMITS.maxYamlDepth),
    maxAliases: bounded(overrides?.maxAliases, DEFAULT_LIMITS.maxAliases),
  };
}

function unreadableConcept(path: string): Concept {
  return { id: path.slice(0, -3), path, metadata: null, body: "", links: [] };
}

export async function readKnowledgeBundle(
  bundleRoot: string,
  options: KnowledgeBundleReadOptions = {},
): Promise<KnowledgeBundleReadResult> {
  const limits = safeLimits(options.limits);
  const requestedRoot = resolve(bundleRoot);
  const canonicalRoot = await realpath(requestedRoot);
  const nativeDiagnostics: Diagnostic[] = [];
  const okfDiagnostics: Diagnostic[] = [];
  const referenceDiagnostics = new Map<ReferenceOperation, Diagnostic[]>();
  const operations = options.referenceOperations ?? REFERENCE_TOOL_PROFILE.operations;
  for (const operation of operations) referenceDiagnostics.set(operation, []);

  const files = await discoverBundleFiles(canonicalRoot, nativeDiagnostics);
  diagnoseAmbiguousIds(files, nativeDiagnostics);

  const concepts: Concept[] = [];
  const assets: BundleAsset[] = [];
  const reservedDocuments: ReservedDocument[] = [];
  const rawByPath = new Map<string, string>();
  const bodyLocations = new Map<string, { offset: number; startLine: number }>();

  for (const file of files) {
    if (file.kind === "asset") {
      assets.push({ path: file.path });
      continue;
    }

    if (file.kind === "index" || file.kind === "log") {
      reservedDocuments.push({ path: file.path, kind: file.kind });
    }

    let raw: string;
    try {
      const bytes = await readFile(file.absolutePath);
      if (bytes.byteLength > limits.maxFileBytes) {
        add(
          nativeDiagnostics,
          "native-contract",
          file.path,
          "file-size-limit",
          "File exceeds the configured safe reader limit.",
        );
        if (file.kind === "concept") {
          add(
            okfDiagnostics,
            "okf-conformance",
            file.path,
            "concept-unreadable",
            "Concept could not be read as UTF-8 Markdown.",
          );
          concepts.push(unreadableConcept(file.path));
        }
        continue;
      }
      raw = decoder.decode(bytes);
    } catch {
      const code = "invalid-utf8";
      add(
        nativeDiagnostics,
        "native-contract",
        file.path,
        code,
        "Bundle Markdown must be valid UTF-8.",
      );
      if (file.kind === "concept") {
        add(
          okfDiagnostics,
          "okf-conformance",
          file.path,
          code,
          "Concept must be valid UTF-8 Markdown.",
        );
        concepts.push(unreadableConcept(file.path));
      }
      continue;
    }
    rawByPath.set(file.path, raw);

    if (file.kind === "index" || file.kind === "log") {
      validateReservedDocument(file, raw, okfDiagnostics, nativeDiagnostics);
      continue;
    }

    const parsed = parseConceptFrontmatter(raw, limits);
    for (const problem of parsed.errors) {
      add(nativeDiagnostics, "native-contract", file.path, problem.code, problem.message, problem);
      if (problem.upstreamFailure) {
        add(okfDiagnostics, "okf-conformance", file.path, problem.code, problem.message, problem);
      }
    }

    if (parsed.metadata) {
      validateCoreFields(file.path, parsed.metadata, okfDiagnostics, nativeDiagnostics);
    } else if (!parsed.errors.some(({ upstreamFailure }) => upstreamFailure)) {
      const upstream = parseReferenceDocument(raw).metadata;
      if (!upstream || typeof upstream.type !== "string" || upstream.type.trim() === "") {
        add(
          okfDiagnostics,
          "okf-conformance",
          file.path,
          "type-required",
          "Concept type must be a non-empty string.",
        );
      }
    }

    const id = file.path.slice(0, -3);
    bodyLocations.set(id, { offset: parsed.bodyOffset, startLine: parsed.bodyStartLine });
    concepts.push({
      id,
      path: file.path,
      metadata: parsed.metadata,
      body: parsed.body,
      links: [],
    });
  }

  const conceptIds = new Set(concepts.map(({ id }) => id));
  const assetPaths = new Set(assets.map(({ path }) => path));
  for (const concept of concepts) {
    concept.links = parseLinkOccurrences(
      concept,
      conceptIds,
      assetPaths,
      bodyLocations.get(concept.id) ?? { offset: 0, startLine: 1 },
    );
    for (const link of concept.links) {
      if (link.classification === "broken") {
        add(
          nativeDiagnostics,
          "native-contract",
          concept.path,
          "broken-concept-link",
          `Link target does not identify a Concept: ${link.originalDestination}`,
          link.position.start,
          "warning",
        );
      } else if (link.classification === "out-of-bundle") {
        add(
          nativeDiagnostics,
          "native-contract",
          concept.path,
          "out-of-bundle-link",
          `Link escapes or identifies a private path: ${link.originalDestination}`,
          link.position.start,
        );
      }
    }
  }

  validateNativeReservedDocuments(reservedDocuments, rawByPath, nativeDiagnostics);
  for (const diagnostic of okfDiagnostics) {
    if (
      diagnostic.severity === "error" &&
      !nativeDiagnostics.some(
        ({ code, path }) => code === diagnostic.code && path === diagnostic.path,
      )
    ) {
      add(
        nativeDiagnostics,
        "native-contract",
        diagnostic.path,
        diagnostic.code,
        diagnostic.message,
        diagnostic,
      );
    }
  }
  evaluateReferenceCompatibility(concepts, reservedDocuments, rawByPath, referenceDiagnostics);

  const relationships = deriveRelationships(concepts);
  const nativeApplicable = options.nativeContractApplicable !== false;
  return {
    root: canonicalRoot,
    concepts: concepts.sort(comparePath),
    assets: assets.sort(comparePath),
    reservedDocuments: reservedDocuments.sort(comparePath),
    relationships,
    okfConformance: resultFor(okfDiagnostics, OKF_PROFILE.version, OKF_PROFILE.revision),
    nativeContract: nativeApplicable
      ? resultFor(nativeDiagnostics, "native-okf", "docs/specifications/native-okf.md")
      : {
          status: "not-applicable",
          version: "native-okf",
          revision: "docs/specifications/native-okf.md",
          diagnostics: nativeDiagnostics,
        },
    referenceCompatibility: operations.map((operation) => ({
      operation,
      ...resultFor(
        referenceDiagnostics.get(operation) ?? [],
        "knowledge-catalog-reference-agent",
        REFERENCE_TOOL_PROFILE.revision,
      ),
    })),
  };
}

async function discoverBundleFiles(
  root: string,
  nativeDiagnostics: Diagnostic[],
): Promise<DiscoveredFile[]> {
  const files: DiscoveredFile[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const path = toLogicalPath(relative(root, absolutePath));
      const stat = await lstat(absolutePath);
      if (stat.isSymbolicLink()) {
        let target: string;
        try {
          target = await realpath(absolutePath);
        } catch {
          add(
            nativeDiagnostics,
            "native-contract",
            path,
            "broken-symbolic-link",
            "Symbolic link target cannot be resolved.",
          );
          continue;
        }
        const targetRelative = relative(root, target);
        if (escapesRoot(targetRelative)) {
          add(
            nativeDiagnostics,
            "native-contract",
            path,
            "symbolic-link-escape",
            "Symbolic link resolves outside the Canonical Knowledge Bundle.",
          );
        } else {
          add(
            nativeDiagnostics,
            "native-contract",
            path,
            "ambiguous-symbolic-link",
            "Symbolic links create ambiguous bundle identities and are not followed.",
          );
        }
        continue;
      }
      if (stat.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!stat.isFile()) continue;
      const kind = classifyFile(entry.name);
      files.push({ absolutePath, path, kind });
    }
  }

  await walk(root);
  return files.sort(comparePath);
}

function classifyFile(basename: string): DiscoveredFile["kind"] {
  if (basename === "index.md") return "index";
  if (basename === "log.md") return "log";
  if (basename.endsWith(".md")) return "concept";
  return "asset";
}

function diagnoseAmbiguousIds(files: DiscoveredFile[], diagnostics: Diagnostic[]): void {
  const normalized = new Map<string, string>();
  for (const file of files.filter(({ kind }) => kind === "concept")) {
    const id = file.path.slice(0, -3);
    const key = id.normalize("NFC");
    const previous = normalized.get(key);
    if (previous && previous !== id) {
      add(
        diagnostics,
        "native-contract",
        file.path,
        "ambiguous-concept-id",
        `Concept ID ambiguously normalizes to the same value as ${previous}.`,
      );
    } else {
      normalized.set(key, id);
    }
    if (id.includes("\\") || isAbsolute(id) || /^[A-Za-z]:/.test(id)) {
      add(
        diagnostics,
        "native-contract",
        file.path,
        "ambiguous-concept-id",
        "Concept ID is absolute or has platform-ambiguous separators.",
      );
    }
  }
}

function parseConceptFrontmatter(raw: string, limits: ReaderLimits): ParsedFrontmatter {
  if (raw.startsWith("\ufeff")) {
    return parseFailure(
      raw,
      "frontmatter-bom",
      "A BOM before the opening frontmatter delimiter is not accepted.",
    );
  }
  const lines = raw.split("\n");
  if (stripCr(lines[0] ?? "") !== "---") {
    return parseFailure(
      raw,
      "frontmatter-opening-delimiter",
      "Concept must start with an exact standalone --- delimiter.",
    );
  }
  let closing = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (stripCr(lines[index] ?? "") === "---") {
      closing = index;
      break;
    }
  }
  if (closing < 0) {
    return parseFailure(
      raw,
      "frontmatter-unterminated",
      "Concept frontmatter has no exact closing delimiter.",
    );
  }

  const yamlSource = lines.slice(1, closing).join("\n");
  const bodyOffset = lines.slice(0, closing + 1).reduce((sum, line) => sum + line.length + 1, 0);
  const body = raw.slice(Math.min(bodyOffset, raw.length));
  const document = parseDocument(yamlSource, {
    schema: "core",
    intAsBigInt: true,
    uniqueKeys: true,
    prettyErrors: false,
  });
  const errors: ParseProblem[] = document.errors.map((error) => {
    const duplicate = error.code === "DUPLICATE_KEY";
    const customTag = error.code === "TAG_RESOLVE_FAILED";
    return {
      code: duplicate ? "yaml-duplicate-key" : customTag ? "yaml-custom-tag" : "yaml-parse-error",
      message: error.message,
      line: error.linePos?.[0]?.line ? error.linePos[0].line + 1 : undefined,
      column: error.linePos?.[0]?.col,
      upstreamFailure: !duplicate && !customTag,
    };
  });

  if (!document.contents || !isMap(document.contents)) {
    errors.push({
      code: "yaml-root-not-mapping",
      message: "Frontmatter root must be a YAML mapping.",
      upstreamFailure: document.contents !== null,
    });
  }

  if (document.contents) inspectYamlTree(document.contents, document, limits, errors);
  if (errors.length > 0 || !document.contents || !isMap(document.contents)) {
    return { metadata: null, body, bodyOffset, bodyStartLine: closing + 2, errors };
  }

  try {
    const value = document.toJS({ maxAliasCount: limits.maxAliases }) as Concept["metadata"];
    return { metadata: value, body, bodyOffset, bodyStartLine: closing + 2, errors };
  } catch (error) {
    errors.push({
      code: "yaml-alias-expansion",
      message: error instanceof Error ? error.message : "Unsafe YAML alias expansion.",
      upstreamFailure: false,
    });
    return { metadata: null, body, bodyOffset, bodyStartLine: closing + 2, errors };
  }
}

function inspectYamlTree(
  root: YamlNode,
  document: Document,
  limits: ReaderLimits,
  errors: ParseProblem[],
): void {
  let nodes = 0;
  let aliases = 0;
  const active = new Set<YamlNode>();

  function visit(node: YamlNode | Pair | null, depth: number): void {
    if (!node) return;
    nodes += 1;
    if (nodes > limits.maxYamlNodes) {
      if (!errors.some(({ code }) => code === "yaml-node-limit")) {
        errors.push({
          code: "yaml-node-limit",
          message: "YAML structure exceeds the configured node limit.",
          upstreamFailure: false,
        });
      }
      return;
    }
    if (depth > limits.maxYamlDepth) {
      if (!errors.some(({ code }) => code === "yaml-depth-limit")) {
        errors.push({
          code: "yaml-depth-limit",
          message: "YAML structure exceeds the configured depth limit.",
          upstreamFailure: false,
        });
      }
      return;
    }
    if (isPair(node)) {
      if (isScalar(node.key) && node.key.value === "<<") {
        errors.push({
          code: "yaml-merge-key",
          message: "YAML merge keys are not allowed.",
          upstreamFailure: false,
        });
      }
      visit(node.key as YamlNode, depth + 1);
      visit(node.value as YamlNode, depth + 1);
      return;
    }
    const tag = "tag" in node ? node.tag : undefined;
    if (typeof tag === "string" && tag.startsWith("!") && !tag.startsWith("tag:yaml.org,2002:")) {
      errors.push({
        code: "yaml-custom-tag",
        message: `Custom YAML tag is not allowed: ${tag}`,
        upstreamFailure: false,
      });
    }
    if (isAlias(node)) {
      aliases += 1;
      if (aliases > limits.maxAliases) {
        errors.push({
          code: "yaml-alias-limit",
          message: "YAML aliases exceed the configured limit.",
          upstreamFailure: false,
        });
      }
      try {
        const source = (node as Alias).resolve(document) as YamlNode | undefined;
        if (source && active.has(source)) {
          errors.push({
            code: "yaml-cyclic-alias",
            message: "Cyclic YAML aliases are not allowed.",
            upstreamFailure: false,
          });
        }
      } catch {
        // The parser reports unresolved aliases separately.
      }
      return;
    }
    if (active.has(node)) {
      errors.push({
        code: "yaml-cyclic-alias",
        message: "Cyclic YAML structures are not allowed.",
        upstreamFailure: false,
      });
      return;
    }
    active.add(node);
    if (isMap(node) || isSeq(node)) {
      for (const item of node.items) visit(item as YamlNode | Pair, depth + 1);
    }
    active.delete(node);
  }

  visit(root, 0);
}

function parseFailure(raw: string, code: string, message: string): ParsedFrontmatter {
  return {
    metadata: null,
    body: raw,
    bodyOffset: 0,
    bodyStartLine: 1,
    errors: [{ code, message, upstreamFailure: true }],
  };
}

function validateCoreFields(
  path: string,
  metadata: NonNullable<Concept["metadata"]>,
  okfDiagnostics: Diagnostic[],
  nativeDiagnostics: Diagnostic[],
): void {
  if (typeof metadata.type !== "string" || metadata.type.trim() === "") {
    add(
      okfDiagnostics,
      "okf-conformance",
      path,
      "type-required",
      "Concept type must be a non-empty string.",
    );
  }
  for (const key of ["type", "title", "description", "timestamp"] as const) {
    if (typeof metadata[key] !== "string" || metadata[key].trim() === "") {
      add(
        nativeDiagnostics,
        "native-contract",
        path,
        `core-field-${key}`,
        `Core field ${key} must be a non-empty string.`,
      );
    }
  }
  if (typeof metadata.timestamp === "string" && !isUtcTimestamp(metadata.timestamp)) {
    add(
      nativeDiagnostics,
      "native-contract",
      path,
      "concept-timestamp",
      "Concept Timestamp must be an ISO 8601 UTC datetime ending in Z.",
    );
  }
}

function isUtcTimestamp(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

function parseLinkOccurrences(
  concept: Concept,
  conceptIds: Set<string>,
  assetPaths: Set<string>,
  bodyLocation: { offset: number; startLine: number },
): LinkOccurrence[] {
  const root = fromMarkdown(concept.body) as unknown as MarkdownNode;
  const definitions = new Map<string, MarkdownNode>();
  for (const child of root.children ?? []) collectDefinitions(child, definitions);
  const links: LinkOccurrence[] = [];
  let citationContext = false;

  for (const child of root.children ?? []) {
    if (child.type === "heading" && child.depth === 1) {
      citationContext = textOf(child).trim().toLowerCase() === "citations";
    }
    collectLinks(
      child,
      citationContext,
      definitions,
      concept,
      conceptIds,
      assetPaths,
      bodyLocation,
      links,
    );
  }
  return links;
}

function collectDefinitions(node: MarkdownNode, definitions: Map<string, MarkdownNode>): void {
  if (node.type === "definition" && node.identifier)
    definitions.set(node.identifier.toLowerCase(), node);
  for (const child of node.children ?? []) collectDefinitions(child, definitions);
}

function collectLinks(
  node: MarkdownNode,
  citationContext: boolean,
  definitions: Map<string, MarkdownNode>,
  concept: Concept,
  conceptIds: Set<string>,
  assetPaths: Set<string>,
  bodyLocation: { offset: number; startLine: number },
  output: LinkOccurrence[],
): void {
  let destination: string | undefined;
  let referenceLabel: string | undefined;
  if (node.type === "link") destination = node.url;
  if (node.type === "linkReference" && node.identifier) {
    const definition = definitions.get(node.identifier.toLowerCase());
    destination = definition?.url;
    referenceLabel = node.label ?? node.identifier;
  }
  const isAutolink =
    node.type === "link" &&
    node.position?.start.offset !== undefined &&
    concept.body[node.position.start.offset] === "<";
  if (destination && node.position && !isAutolink) {
    const resolved = resolveLink(concept.id, destination, conceptIds, assetPaths);
    output.push({
      label: textOf(node),
      originalDestination: destination,
      normalizedTarget: resolved.normalizedTarget,
      fragment: resolved.fragment,
      classification: resolved.classification,
      citationContext,
      referenceLabel,
      position: absolutePosition(node.position, bodyLocation),
    });
  }
  for (const child of node.children ?? []) {
    collectLinks(
      child,
      citationContext,
      definitions,
      concept,
      conceptIds,
      assetPaths,
      bodyLocation,
      output,
    );
  }
}

function resolveLink(
  sourceId: string,
  destination: string,
  conceptIds: Set<string>,
  assetPaths: Set<string>,
): Pick<LinkOccurrence, "normalizedTarget" | "fragment" | "classification"> {
  const hash = destination.indexOf("#");
  const destinationPath = hash >= 0 ? destination.slice(0, hash) : destination;
  const query = destinationPath.indexOf("?");
  const rawPath = query >= 0 ? destinationPath.slice(0, query) : destinationPath;
  const rawFragment = hash >= 0 ? destination.slice(hash + 1) : undefined;
  let fragment: string | undefined;
  try {
    fragment = rawFragment === undefined ? undefined : decodeURIComponent(rawFragment);
  } catch {
    fragment = rawFragment;
  }

  if (/^(?:file):/i.test(rawPath) || /^\/?[A-Za-z]:[\\/]/.test(rawPath)) {
    return { classification: "out-of-bundle", fragment };
  }
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(rawPath) || rawPath.startsWith("//")) {
    return { classification: "external", fragment };
  }

  let decoded: string;
  try {
    const decodedParts = rawPath.split("/").map((part) => decodeURIComponent(part));
    if (decodedParts.some((part) => part.includes("/") || part.includes("\\"))) {
      return { classification: "out-of-bundle", fragment };
    }
    decoded = decodedParts.join("/");
  } catch {
    return { classification: "broken", fragment };
  }

  const base = sourceId.includes("/") ? sourceId.slice(0, sourceId.lastIndexOf("/")) : "";
  const combined =
    decoded === ""
      ? `${sourceId}.md`
      : decoded.startsWith("/")
        ? decoded.slice(1)
        : `${base ? `${base}/` : ""}${decoded}`;
  const normalizedPath = normalizeLogicalPath(combined);
  if (!normalizedPath) return { classification: "out-of-bundle", fragment };
  const hasMarkdownSuffix = normalizedPath.endsWith(".md");
  const normalizedTarget = hasMarkdownSuffix ? normalizedPath.slice(0, -3) : normalizedPath;
  if ((hasMarkdownSuffix || rawPath === "") && conceptIds.has(normalizedTarget)) {
    return { classification: "valid", normalizedTarget, fragment };
  }
  if (rawPath.startsWith("/") && /^\/(?:Users|home|private|var|etc)\//.test(rawPath)) {
    return { classification: "out-of-bundle", fragment };
  }
  if (assetPaths.has(normalizedPath))
    return { classification: "bundle-asset", normalizedTarget, fragment };
  return { classification: "broken", normalizedTarget, fragment };
}

function normalizeLogicalPath(path: string): string | undefined {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function absolutePosition(
  position: SourcePosition,
  bodyLocation: { offset: number; startLine: number },
): SourcePosition {
  const adjust = (point: SourcePosition["start"]): SourcePosition["start"] => ({
    line: point.line + bodyLocation.startLine - 1,
    column: point.column,
    offset: point.offset === undefined ? undefined : point.offset + bodyLocation.offset,
  });
  return { start: adjust(position.start), end: adjust(position.end) };
}

function deriveRelationships(concepts: Concept[]): ConceptRelationship[] {
  const relationships: ConceptRelationship[] = [];
  const seen = new Set<string>();
  for (const concept of concepts.sort(comparePath)) {
    for (const link of concept.links) {
      if (
        link.classification !== "valid" ||
        !link.normalizedTarget ||
        link.normalizedTarget === concept.id
      )
        continue;
      const key = `${concept.id}\0${link.normalizedTarget}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relationships.push({ source: concept.id, target: link.normalizedTarget });
    }
  }
  return relationships;
}

function validateReservedDocument(
  file: DiscoveredFile,
  raw: string,
  okfDiagnostics: Diagnostic[],
  nativeDiagnostics: Diagnostic[],
): void {
  if (file.kind === "index") {
    const isRoot = file.path === "index.md";
    let body = raw;
    if (raw.startsWith("---\n") || raw.startsWith("---\r\n")) {
      if (!isRoot) {
        add(
          okfDiagnostics,
          "okf-conformance",
          file.path,
          "nested-index-frontmatter",
          "Only the root index.md may contain frontmatter.",
        );
      }
      const parsed = parseConceptFrontmatter(raw, DEFAULT_LIMITS);
      body = parsed.body;
      if (!parsed.metadata) {
        add(
          okfDiagnostics,
          "okf-conformance",
          file.path,
          "index-frontmatter",
          "Root index frontmatter must be a YAML mapping.",
        );
      } else if (Object.keys(parsed.metadata).some((key) => key !== "okf_version")) {
        add(
          okfDiagnostics,
          "okf-conformance",
          file.path,
          "index-frontmatter-field",
          "Root index frontmatter may contain only okf_version.",
        );
      } else if (
        parsed.metadata.okf_version !== undefined &&
        parsed.metadata.okf_version !== OKF_PROFILE.version
      ) {
        add(
          okfDiagnostics,
          "okf-conformance",
          file.path,
          "unknown-okf-version",
          `Declared OKF version ${String(parsed.metadata.okf_version)} is outside the pinned profile; consumption continues best-effort.`,
          undefined,
          "warning",
        );
      }
    }
    const tree = fromMarkdown(body) as unknown as MarkdownNode;
    if (!(tree.children ?? []).some(({ type }) => type === "heading")) {
      add(
        okfDiagnostics,
        "okf-conformance",
        file.path,
        "index-structure",
        "index.md must use Markdown heading sections.",
      );
    }
    return;
  }

  if (/^---(?:\r)?$/m.test(raw.split("\n")[0] ?? "")) {
    add(
      okfDiagnostics,
      "okf-conformance",
      file.path,
      "log-frontmatter",
      "log.md must not contain frontmatter.",
    );
  }
  const headings = [...raw.matchAll(/^#{1,6}\s+(\d{4}-\d{2}-\d{2})\s*$/gm)].map(
    (match) => match[1] ?? "",
  );
  if (raw.trim() && headings.length === 0) {
    add(
      okfDiagnostics,
      "okf-conformance",
      file.path,
      "log-date-heading",
      "log.md must group entries under YYYY-MM-DD headings.",
    );
  }
  if (headings.some((date, index) => index > 0 && date > (headings[index - 1] ?? ""))) {
    add(
      okfDiagnostics,
      "okf-conformance",
      file.path,
      "log-order",
      "log.md date groups must be newest first.",
    );
  }
  if (file.path !== "log.md") {
    add(
      nativeDiagnostics,
      "native-contract",
      file.path,
      "nested-log",
      "The Native OKF Contract permits only the root log.md.",
    );
  }
}

function validateNativeReservedDocuments(
  reserved: ReservedDocument[],
  rawByPath: Map<string, string>,
  diagnostics: Diagnostic[],
): void {
  const rootIndex = reserved.find(({ path }) => path === "index.md");
  if (!rootIndex) {
    add(
      diagnostics,
      "native-contract",
      "index.md",
      "root-index-required",
      "The Canonical Knowledge Bundle requires a root Navigation Index.",
    );
  } else {
    const raw = rawByPath.get("index.md") ?? "";
    const parsed = parseConceptFrontmatter(raw, DEFAULT_LIMITS);
    if (parsed.metadata?.okf_version !== OKF_PROFILE.version) {
      add(
        diagnostics,
        "native-contract",
        "index.md",
        "okf-version",
        'Root Navigation Index must declare okf_version: "0.1".',
      );
    }
  }
  if (!reserved.some(({ path }) => path === "log.md")) {
    add(
      diagnostics,
      "native-contract",
      "log.md",
      "root-log-required",
      "The Canonical Knowledge Bundle requires one root log.md.",
    );
  }
}

function evaluateReferenceCompatibility(
  concepts: Concept[],
  reservedDocuments: ReservedDocument[],
  rawByPath: Map<string, string>,
  diagnostics: Map<ReferenceOperation, Diagnostic[]>,
): void {
  for (const reserved of reservedDocuments) {
    if (reserved.kind === "log") {
      refAdd(
        diagnostics,
        "index-generation",
        reserved.path,
        "reference-log-as-concept",
        "Reference index generation includes log.md as a Concept-like entry.",
      );
      refAdd(
        diagnostics,
        "graph-extraction",
        reserved.path,
        "reference-log-as-concept",
        "Reference graph extraction displays log.md as an Unknown Concept.",
      );
    }
    if (reserved.path === "index.md" && rawByPath.get(reserved.path)?.startsWith("---")) {
      refAdd(
        diagnostics,
        "index-generation",
        reserved.path,
        "reference-version-loss",
        "Reference index generation overwrites the root OKF version declaration when entries exist.",
      );
    }
  }

  for (const concept of concepts) {
    const raw = rawByPath.get(concept.path);
    if (raw === undefined) continue;
    const reference = parseReferenceDocument(raw);
    if (reference.error) {
      refAdd(diagnostics, "document-parse", concept.path, "reference-parse", reference.error);
      refAdd(
        diagnostics,
        "document-write-validation",
        concept.path,
        "reference-parse",
        reference.error,
      );
      refAdd(
        diagnostics,
        "index-generation",
        concept.path,
        "reference-index-skip",
        "Reference index generation silently skips this document.",
        "warning",
      );
      refAdd(
        diagnostics,
        "graph-extraction",
        concept.path,
        "reference-viewer-skip",
        "Reference graph extraction silently skips this document.",
        "warning",
      );
      continue;
    }
    const missing = ["type", "title", "description", "timestamp"].filter(
      (key) => !pythonTruthy(reference.metadata?.[key]),
    );
    if (missing.length > 0) {
      refAdd(
        diagnostics,
        "document-write-validation",
        concept.path,
        "reference-required-keys",
        `Reference document write validation rejects falsey keys: ${missing.join(", ")}.`,
      );
    }
    for (const link of concept.links) {
      if (link.referenceLabel) {
        refAdd(
          diagnostics,
          "graph-extraction",
          concept.path,
          "reference-link-unsupported",
          "Reference graph extraction does not recognize reference-style links.",
        );
      } else if (link.originalDestination.startsWith("/")) {
        refAdd(
          diagnostics,
          "graph-extraction",
          concept.path,
          "reference-root-link-unsupported",
          "Reference graph extraction drops bundle-root-relative links.",
        );
      } else if (/%[\dA-Fa-f]{2}/.test(link.originalDestination)) {
        refAdd(
          diagnostics,
          "graph-extraction",
          concept.path,
          "reference-url-decoding",
          "Reference graph extraction does not URL-decode Concept paths.",
        );
      }
      if (!link.originalDestination.startsWith("/") || link.fragment !== undefined) {
        refAdd(
          diagnostics,
          "viewer-navigation",
          concept.path,
          "reference-navigation-unsupported",
          "Reference viewer navigation only handles fragment-free bundle-root .md links.",
        );
      }
    }
  }
}

function parseReferenceDocument(raw: string): {
  metadata: Record<string, unknown> | null;
  error?: string;
} {
  const lines = raw.split(/\r?\n/);
  if ((lines[0] ?? "").trim() !== "---") return { metadata: {} };
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing < 0) return { metadata: null, error: "Unterminated YAML frontmatter block." };
  const document = parseDocument(lines.slice(1, closing).join("\n"), {
    schema: "yaml-1.1",
    uniqueKeys: false,
    merge: true,
  });
  if (document.errors.length > 0)
    return { metadata: null, error: document.errors[0]?.message ?? "YAML parse failed." };
  const value = document.toJS();
  if (value == null) return { metadata: {} };
  if (typeof value !== "object" || Array.isArray(value))
    return { metadata: null, error: "Frontmatter must be a YAML mapping." };
  return { metadata: value as Record<string, unknown> };
}

function pythonTruthy(value: unknown): boolean {
  if (value == null || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

function refAdd(
  diagnostics: Map<ReferenceOperation, Diagnostic[]>,
  operation: ReferenceOperation,
  path: string,
  code: string,
  message: string,
  severity: DiagnosticSeverity = "error",
): void {
  const target = diagnostics.get(operation);
  if (target) add(target, `reference:${operation}`, path, code, message, undefined, severity);
}

function add(
  diagnostics: Diagnostic[],
  profile: DiagnosticProfile,
  path: string,
  code: string,
  message: string,
  location?: { line?: number; column?: number },
  severity: DiagnosticSeverity = "error",
): void {
  diagnostics.push({
    profile,
    severity,
    code,
    message,
    path,
    line: location?.line,
    column: location?.column,
  });
}

function resultFor(diagnostics: Diagnostic[], version: string, revision: string): ValidationResult {
  return {
    status: diagnostics.some(({ severity }) => severity === "error") ? "fail" : "pass",
    version,
    revision,
    diagnostics,
  };
}

function textOf(node: MarkdownNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textOf).join("");
}

function stripCr(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function toLogicalPath(value: string): string {
  return sep === "/" ? value : value.split(sep).join("/");
}

function escapesRoot(value: string): boolean {
  return value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value);
}

function comparePath<T extends { path: string }>(left: T, right: T): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}
