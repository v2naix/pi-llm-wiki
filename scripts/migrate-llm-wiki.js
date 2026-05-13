#!/usr/bin/env node

/**
 * migrate-llm-wiki.js
 *
 * One-time migration script: moves an old-style wiki vault (.wiki/ sentinel)
 * to the new .llm-wiki/ layout.
 *
 * Usage:
 *   node scripts/migrate-llm-wiki.js              # Run in wiki root directory
 *   node scripts/migrate-llm-wiki.js ~/my-wiki     # Run at specific path
 *   node scripts/migrate-llm-wiki.js --dry-run     # Preview without changes
 *   node scripts/migrate-llm-wiki.js --force        # Skip confirmation prompt
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── Helpers ────────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

function log(action, ...args) {
  const prefix = DRY_RUN ? "[DRY-RUN]" : "[MIGRATE]";
  console.log(`${prefix} ${action}`, ...args);
}

function moveDir(src, dest, name) {
  if (!existsSync(src)) {
    log(`SKIP ${name} — source does not exist: ${src}`);
    return;
  }
  if (existsSync(dest)) {
    log(`SKIP ${name} — destination already exists: ${dest}`);
    return;
  }
  log(`MOVE ${name}: ${src} → ${dest}`);
  if (!DRY_RUN) {
    mkdirSync(dest, { recursive: true });
    renameSync(src, dest);
  }
}

// ─── Main ───────────────────────────────────────────────

async function main() {
  // Determine root directory
  const root = process.argv[2] ? join(process.cwd(), process.argv[2]) : process.cwd();

  console.log(`\n🔍 Scanning for legacy wiki at: ${root}\n`);

  // Check for old-style vault
  const oldSentinel = join(root, ".wiki", "config.json");
  const newSentinel = join(root, ".llm-wiki", "config.json");

  if (!existsSync(oldSentinel)) {
    console.log("❌ No legacy wiki found (no .wiki/config.json). Nothing to migrate.");
    if (existsSync(newSentinel)) {
      console.log("   ✓ New-format wiki already exists at .llm-wiki/");
    } else {
      console.log("   No wiki vault found. Use wiki_bootstrap to create one.");
    }
    process.exit(0);
  }

  if (existsSync(newSentinel)) {
    console.log(
      "⚠️  Both legacy (.wiki/) and new (.llm-wiki/) vaults detected.\n" +
        "   The new vault already exists. Remove .llm-wiki/ first or specify a different root.",
    );
    process.exit(1);
  }

  // Migration plan
  const moves = [
    {
      src: join(root, ".wiki", "config.json"),
      dest: join(root, ".llm-wiki", "config.json"),
      type: "file",
      name: "config",
    },
    {
      src: join(root, ".wiki", "templates"),
      dest: join(root, ".llm-wiki", "templates"),
      type: "dir",
      name: "templates",
    },
    {
      src: join(root, "raw"),
      dest: join(root, ".llm-wiki", "raw"),
      type: "dir",
      name: "raw sources",
    },
    {
      src: join(root, "wiki"),
      dest: join(root, ".llm-wiki", "wiki"),
      type: "dir",
      name: "wiki pages",
    },
    {
      src: join(root, "meta"),
      dest: join(root, ".llm-wiki", "meta"),
      type: "dir",
      name: "metadata",
    },
    {
      src: join(root, "outputs"),
      dest: join(root, ".llm-wiki", "outputs"),
      type: "dir",
      name: "outputs",
    },
    {
      src: join(root, ".discoveries"),
      dest: join(root, ".llm-wiki", ".discoveries"),
      type: "dir",
      name: "discovery tracking",
    },
  ];

  // Check for WIKI_SCHEMA.md at root
  const oldSchema = join(root, "WIKI_SCHEMA.md");
  const schemas = [];
  if (existsSync(oldSchema)) {
    schemas.push({ src: oldSchema, dest: join(root, ".llm-wiki", "WIKI_SCHEMA.md") });
  }

  // Print plan
  console.log("📋 Migration plan:");
  console.log("   Legacy format → New format");
  console.log("   ─────────────────────────────");
  for (const m of moves) {
    console.log(`   ${existsSync(m.src) ? "✓" : "○"} ${m.name}: ${m.src} → ${m.dest}`);
  }
  for (const s of schemas) {
    console.log(`   ✓ WIKI_SCHEMA: ${s.src} → ${s.dest}`);
  }

  // Remaining .wiki/ dir contents (after config + templates moved)
  const dotWikiContents = readdirSync(join(root, ".wiki")).filter(
    (e) => e !== "config.json" && e !== "templates",
  );
  if (dotWikiContents.length > 0) {
    console.log(
      `\n   ⚠️ Additional .wiki/ contents (${dotWikiContents.length} items) will be left in place.`,
    );
    for (const c of dotWikiContents) {
      console.log(`      .wiki/${c}`);
    }
  }

  // Confirmation
  if (!FORCE && !DRY_RUN) {
    console.log("\n❓ Proceed with migration? (y/N)");
    // Read from stdin
    process.stdin.setRawMode?.(false);
    const answer = await new Promise((resolve) => {
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim().toLowerCase());
      });
    });
    if (answer !== "y" && answer !== "yes") {
      console.log("Migration cancelled.");
      process.exit(0);
    }
  }

  // Execute
  console.log("");
  for (const m of moves) {
    if (m.type === "dir") {
      moveDir(m.src, m.dest, m.name);
    } else {
      moveDir(m.src, m.dest, m.name);
    }
  }

  // Move WIKI_SCHEMA.md
  for (const s of schemas) {
    log(`MOVE WIKI_SCHEMA: ${s.src} → ${s.dest}`);
    if (!DRY_RUN) {
      mkdirSync(join(root, ".llm-wiki"), { recursive: true });
      renameSync(s.src, s.dest);
    }
  }

  // Create forwarding marker in old .wiki/
  if (!DRY_RUN) {
    const forwardingMarker = join(root, ".wiki", "MIGRATED_TO_LLM_WIKI.md");
    const newRoot = join(root, ".llm-wiki");
    writeFileSync(
      forwardingMarker,
      [
        "# Migration Complete",
        "",
        `This vault was migrated to the new layout at \`.llm-wiki/\` on ${new Date().toISOString().split("T")[0]}.`,
        "",
        "The old `.wiki/` directory is kept as a forwarding marker.",
        "Remove it once you've verified everything works.",
        "",
        `New location: \`${newRoot}\``,
        "",
      ].join("\n"),
      "utf-8",
    );
    log("CREATE forwarding marker: .wiki/MIGRATED_TO_LLM_WIKI.md");
  }

  console.log("");
  if (DRY_RUN) {
    console.log("✅ Dry-run complete. No changes made.");
    console.log("   Run without --dry-run to perform the migration.");
  } else {
    console.log("✅ Migration complete!");
    console.log("");
    console.log("   What changed:");
    console.log("   • All wiki content moved under .llm-wiki/");
    console.log("   • Raw sources:       .llm-wiki/raw/");
    console.log("   • Wiki pages:        .llm-wiki/wiki/");
    console.log("   • Metadata:          .llm-wiki/meta/");
    console.log("   • Config/templates:  .llm-wiki/ (config.json, templates/)");
    console.log("   • Outputs:           .llm-wiki/outputs/");
    console.log("   • Forwarding marker: .wiki/MIGRATED_TO_LLM_WIKI.md");
    console.log("");
    console.log("   The old .wiki/ dir is kept as a marker. You can remove it once verified.");
    console.log("");
    console.log("   Update your gitignore:");
    console.log("     echo '.llm-wiki/' >> .gitignore");
    console.log("");
  }
}

main().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
