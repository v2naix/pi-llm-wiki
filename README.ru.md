<div align="center">

# @zosmaai/pi-llm-wiki

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | **Русский** | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

[![CI](https://github.com/zosmaai/pi-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/zosmaai/pi-llm-wiki/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zosmaai/pi-llm-wiki)](https://www.npmjs.com/package/@zosmaai/pi-llm-wiki)
[![npm downloads](https://img.shields.io/npm/dm/@zosmaai/pi-llm-wiki)](https://www.npmjs.com/package/@zosmaai/pi-llm-wiki)
[![Coverage](https://codecov.io/gh/zosmaai/pi-llm-wiki/branch/main/graph/badge.svg)](https://codecov.io/gh/zosmaai/pi-llm-wiki)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![CodeQL](https://github.com/zosmaai/pi-llm-wiki/actions/workflows/codeql.yml/badge.svg)](https://github.com/zosmaai/pi-llm-wiki/actions/workflows/codeql.yml)
[![GitHub Repo Stars](https://img.shields.io/github/stars/zosmaai/pi-llm-wiki?style=social)](https://github.com/zosmaai/pi-llm-wiki/stargazers)

</div>

<br/>

<div align="center">
  <a href="https://github.com/zosmaai/pi-llm-wiki/stargazers">
    <img src="./assets/thank-you-for-the-star.png" alt="Thank you for starring pi-llm-wiki!" width="100%" />
  </a>
  <br/>
  <sub>
    If you find pi-llm-wiki useful,
    <a href="https://github.com/zosmaai/pi-llm-wiki">⭐ star the repo</a> —
    it lets us know we're building something that matters.
  </sub>
</div>

<br/>

**Самообслуживаемая, совместимая с Obsidian база знаний для [pi](https://pi.dev). Следует шаблону LLM Wiki Андрея Карпатого.**
Follows Andrej Karpathy's [LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

Превратите сырые источники (URLs, PDF, markdown, JSON, XML) в прочную, взаимосвязанную, поддерживаемую LLM вики, которая накапливается со временем.

---

## Native OKF support

`.llm-wiki/wiki/` is the editable and distributable **Canonical Knowledge Bundle**. Pi Extension and MCP Controlled Write Adapters share one Bundle Mutation seam; controlled direct canonical writes and direct edits to generated Reserved Documents are blocked. Private projections and Raw Source Packets remain in the **Private Vault Layer**. Controlled writers emit standard file-relative Markdown links ending in `.md`.

Support targets OKF v0.1 Draft at pinned specification commit `ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a`. Validation separately reports the Native OKF Contract and named reference-tool operations at pinned revision `d44368c15e38e7c92481c5992e4f9b5b421a801d`; no unqualified “Google-compatible” claim is made.

## Быстрый старт

```bash
pi install npm:@zosmaai/pi-llm-wiki
```

The extension will proactively suggest creating a wiki on your first session. Alternatively:

```
/wiki-init "AI Engineering"
/wiki-ingest
/wiki-query What are the key patterns?
```

---

## Почему этот пакет?

Большинство файловых LLM-воркфлоу ведут себя как одноразовый RAG: модель ищет сырые документы каждый раз, когда вы задаёте вопрос. Синтез эфемерен.

**pi-llm-wiki** создаёт промежуточный слой:

- **Пакеты сырых источников сохраняют оригинальные входные данные**
- **Страницы источников резюмируют, что говорит каждый источник**
- **Канонические страницы вики отслеживают текущие знания вики**
- **Сгенерированные метаданные делают всё доступным для поиска и навигации**

Результат — вики, которая накапливается по мере захвата источников, вопросов и архивирования durable-анализов.

---

## Возможности

| Capability | Description |
|------------|-------------|
| 🏠 **Personal fallback** | Always-on `~/.llm-wiki/` vault — knowledge compounds across projects even when no project wiki exists |
| 🔗 **Immutable source capture** | URLs, local files (PDF/md/txt/html/XML/JSON), or pasted text → immutable Raw Source Packets plus Source Concepts |
| 🧠 **Automated ingestion** | `wiki_ingest` batch-processes sources into concept, entity, synthesis & analysis pages |
| 🔍 **Full-text search** | Generated registry with keyword lookup across all pages and sources |
| 🩺 **Mechanical linting** | Orphans, broken links, duplicate aliases, coverage gaps, stale captures |
| 📊 **Dashboard** | `wiki_status` — counts, source states, recent activity |
| 🤖 **Auto-update watch** | `wiki_watch` — print a `crontab` line that runs the full cycle on a schedule |
| 🧠 **Layered recall** | Searches both personal (`~/.llm-wiki/`) and project (`.llm-wiki/`) vaults — personal knowledge follows you everywhere |
| 📝 **Auto-bootstrap** | Extension suggests creating a wiki when none exists in the current directory |
| 💾 **Lightweight capture** | `wiki_retro` — save atomic insights as a single markdown file; full 4-layer pipeline also available via `wiki_capture_source` |
| 🌐 **MCP Server** | Use with Claude Code, Cursor, Windsurf via stdio MCP transport |
| 📝 **Obsidian-friendly** | Standard file-relative Markdown Concept links work in Obsidian and ordinary Markdown readers |
| 🛡️ **Guardrails** | Blocks controlled direct canonical writes and edits to generated Reserved Documents |
| 🔧 **Configurable PDF extraction** | MarkItDown timeout via `WIKI_MARKITDOWN_TIMEOUT_MS` env var |
| 🧪 **38+ tests, CI, CodeQL** | TypeScript, Vitest, Biome, Codecov |

---

## Инструменты

| Tool | Description |
|------|-------------|
| `wiki_bootstrap` | Initialize a Canonical Knowledge Bundle and its Private Vault Layer |
| `wiki_capture_source` | Capture a URL, local file, or pasted text as a Raw Source Packet and Source Concept |
| `wiki_recall` | Search wiki for task-relevant pages — searches both personal (`~/.llm-wiki/`) and project (`.llm-wiki/`) vaults, deduplicated |
| `wiki_retro` | Save atomic insights from completed tasks into the wiki |
| `wiki_ingest` | Synthesize captured Source Concepts through controlled Bundle Mutations |
| `wiki_ensure_page` | Resolve or safely create entity / concept / synthesis / analysis pages |
| `wiki_search` | Search a fresh revision-bound Private Projection |
| `wiki_lint` | Deterministic health checks (orphans, gaps, contradictions, auto-fix) |
| `wiki_status` | Show counts, source states, and recent activity |
| `wiki_rebuild_meta` | Rebuild revision-bound Private Projections |
| `wiki_log_event` | Append a structured event to the wiki activity log |
| `wiki_watch` | Print a `crontab` line for automatic wiki updates (daily / weekly / hourly) — does not install it |

### Слэш-команды

| Command | Description |
|---------|-------------|
| `/wiki-init <topic>` | Initialize a new LLM Wiki vault |
| `/wiki-ingest [path]` | Process new source files and update the wiki |
| `/wiki-query <question>` | Ask questions against the wiki with citations |
| `/wiki-discover [--topic <topic>]` | Auto-discover new sources from the web |
| `/wiki-run [--schedule daily\|weekly]` | Full cycle: discover → ingest → lint |
| `/wiki-lint [--fix]` | Health check (orphans, contradictions, gaps) |
| `/wiki-status` | Show a concise operational summary |
| `/wiki-digest [--period daily\|weekly]` | Generate a digest of recent activity |
| `/wiki-retro` | Save atomic insights from completed tasks |

---

## Многослойная архитектура Vault

Knowledge follows you everywhere. pi-llm-wiki uses a layered vault system:

| Layer | Location | Purpose |
|-------|----------|---------|
| 🏠 **Personal** | `~/.llm-wiki/` | Always active. Zero setup. Knowledge compounds across all your sessions — regardless of which project you're in. |
| 📁 **Project** | `{project}/.llm-wiki/` | Explicit opt-in. Dedicated wiki per project, sharing personal knowledge when relevant. |
| 🏢 **Company** (future) | git-tracked | Shared wiki across a team. `wiki_publish` promotes personal/project pages to the company wiki. |

**Как это работает:**

1. `resolveVaultRoot()` checks: cwd → walk up for `.llm-wiki/` → `~/.llm-wiki/`
2. `wiki_recall` (layered) searches **both** personal and project vaults, merging results with vault labels
3. Personal results are shown first in recall output, tagged as "📓 personal"
4. `wiki_retro` writes to whichever vault is active (project takes priority)
5. Set `WIKI_HOME` env var to override the personal wiki location

This means: you can have a project wiki for team documentation **and** a personal wiki for your own notes, and recall searches both simultaneously.

---

## Быстрый старт (подробно)

### 1) Создать новую вики

```bash
mkdir my-wiki
cd my-wiki
pi
```

Спросите pi:

```
Initialize an llm wiki here for AI research.
```

This calls `wiki_bootstrap` and creates:

```
.llm-wiki/
├── config.json
├── templates/
├── raw/
├── wiki/
├── meta/
└── WIKI_SCHEMA.md
```

### 2) Захватить источник

```
Capture this article into the wiki: https://example.com/some-article
```

```
Capture this PDF into the wiki: ./papers/context-windows.pdf
```

```
Capture these notes into the wiki: ...pasted text...
```

### 3) Интегрировать источник

1. Capture the source with `wiki_capture_source`
2. Let `wiki_ingest` synthesize it through the controlled Source Capture lifecycle
3. Search for impacted Concepts with `wiki_search`
4. Create or replace Concepts only through controlled tools such as `wiki_ensure_page`
5. Use standard Markdown links ending in `.md` for Concept links and citations

### 4) Запросить вики

```
Based on the wiki, what are the main tradeoffs between long-context models and RAG?
```

By default, query mode is **read-only**. To file a durable answer:

```
Answer the question and file the result as an analysis page.
```

---

## Структура Vault

```
my-wiki/
└─ .llm-wiki/
   ├─ config.json               # Vault config
   ├─ templates/                 # Page templates
   ├─ raw/
   │  └─ sources/
   │     └─ <opaque-raw-source-id>/
   │        ├─ manifest.json
   │        ├─ original/           # Original artifact
   │        ├─ extracted.md        # Normalized text
   │        └─ attachments/
   ├─ wiki/
   │  ├─ sources/                  # Source Concepts (reader-visible synthesis)
   │  ├─ concepts/                 # Concepts and recurring ideas
   │  ├─ entities/                 # People, orgs, products, papers, systems
   │  ├─ syntheses/                # Cross-source theses and tensions
   │  └─ analyses/                 # Durable filed answers from queries
   ├─ meta/
   │  ├─ registry.json             # Auto-generated search index
   │  ├─ backlinks.json
   │  ├─ index.md
   │  ├─ events.jsonl              # Append-only event log
   │  ├─ log.md
   │  └─ lint-report.md
   └─ WIKI_SCHEMA.md               # Operating manual
```

### Модель владения

| Path | Owner | Rule |
|------|-------|------|
| Path | Owner | Rule |
|------|-------|------|
| `.llm-wiki/raw/**` | Extension tools | Immutable after capture |
| `.llm-wiki/wiki/**` | Bundle Mutation + external editors | Canonical Knowledge Bundle; controlled direct writes are blocked |
| `.llm-wiki/meta/registry.json` | Extension | Generated |
| `.llm-wiki/meta/backlinks.json` | Extension | Generated |
| `.llm-wiki/meta/index.md` | Extension | Private compatibility projection; not a Navigation Index authority |
| `.llm-wiki/meta/events.jsonl` | Extension / tool | Append-only |
| `.llm-wiki/meta/log.md` | Extension | Private activity projection; not the root Reserved Document |
| `.llm-wiki/meta/lint-report.md` | Extension | Generated |
| `.llm-wiki/WIKI_SCHEMA.md` | Human + explicit request | Operating manual |

---

## Стиль ссылок и цитирования

### Внутренняя навигация

```markdown
[RAG](concepts/retrieval-augmented-generation.md)
[OpenAI](entities/openai.md)
[Long context vs. RAG](syntheses/long-context-vs-rag.md)
```

### Фактические цитаты

```markdown
[Source title](sources/source-title.md)
```

Source Concepts carry stable opaque Raw Source Identifiers in project-namespaced metadata; canonical links target their current folder-qualified Concept paths.

---

## Ограничения

The extension **blocks** direct tool-call edits to:

- `.llm-wiki/raw/**` — immutable source artifacts
- `.llm-wiki/meta/registry.json`
- `.llm-wiki/meta/backlinks.json`
- `.llm-wiki/meta/events.jsonl`
- `.llm-wiki/meta/index.md`
- `.llm-wiki/meta/log.md`
- `.llm-wiki/meta/lint-report.md`

Controlled Pi and MCP writes to `.llm-wiki/wiki/**` must use the shared Bundle Mutation seam. External human/tool edits are detected and require External Reconciliation; they are never silently treated as controlled commits.

---

## Формат пакета источника

Each capture stores one immutable Raw Source Packet in the Private Vault Layer and associates it with one reader-visible Source Concept:

```
.llm-wiki/raw/sources/<opaque-raw-source-id>/
├─ manifest.json     # Capture metadata (title, URL, format, timestamp)
├─ original/         # Original artifact (preserved as-is)
├─ extracted.md      # Normalized text (PDF→md, XML→md, JSON→md, etc.)
└─ attachments/      # Future attachment downloads
```

This preserves both the **original artifact** and a **normalized extracted view** for reading.

---

## MCP-сервер

Use the wiki from **any MCP-compatible tool** — Claude Code, Cursor, Windsurf, and others.

The package ships a standalone MCP server exposing 5 wiki tools over stdio:

| Tool | Description |
|------|-------------|
| `wiki_recall` | Search wiki for task-relevant pages |
| `wiki_search` | Full registry search |
| `wiki_status` | Wiki stats (page counts, type breakdown) |
| `wiki_retro` | Save atomic insights |
| `wiki_capture_source` | Capture text as a Raw Source Packet and Source Concept |

### Использование

```bash
# Auto-discovered by pi:
pi install npm:@zosmaai/pi-llm-wiki

# Standalone with any MCP client:
WIKI_ROOT=~/my-wiki node node_modules/@zosmaai/pi-llm-wiki/mcp/index.js
```

Set `WIKI_ROOT` to your wiki vault directory. If unset, the server auto-detects from the current working directory.

---

## Поведение навыка

The bundled `llm-wiki` skill teaches the model to:

- ❌ Never edit raw sources directly
- ❌ Never treat Private Projections as canonical bundle content
- ✅ Capture first, integrate second
- ✅ Search before creating new canonical pages
- ✅ Cite facts using source-page IDs
- ✅ Keep query mode read-only by default
- ✅ Use "Tensions / caveats" and "Open questions" when evidence is mixed

---

## Архитектура

### Слои Vault

See the [Layered Vault Architecture](#layered-vault-architecture) section above for the personal/project/company layering.

### Четырёхуровневая модель страниц

Each wiki vault has four layers with clear ownership:

```
.llm-wiki/raw/sources/<opaque-id>/ # Immutable Raw Source Packets (private)
.llm-wiki/wiki/                    # Canonical Knowledge Bundle
.llm-wiki/meta/                    # Revision-bound Private Projections
.llm-wiki/                        # Config and templates
```

Read [docs/architecture.md](docs/architecture.md) for the full design document.

---

## Документация

| Document | What it covers |
|----------|---------------|
| [Architecture](docs/architecture.md) | How the four layers work, ownership model |
| [Commands](docs/commands.md) | All slash commands and tool reference |
| [Obsidian Integration](docs/obsidian.md) | Vault setup and recommended plugins |
| [Configuration](docs/configuration.md) | Wiki modes, topics, environment variables |
| [API](docs/api.md) | Extension tool parameter reference |

---

## Участие

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, test patterns, and PR workflow.

---

## История звёзд

[![Star History Chart](https://api.star-history.com/svg?repos=zosmaai/pi-llm-wiki&type=Date)](https://star-history.com/#zosmaai/pi-llm-wiki&Date)

## Контрибьюторы

<a href="https://github.com/zosmaai/pi-llm-wiki/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=zosmaai/pi-llm-wiki" alt="Contributors" />
</a>

---

<div align="center">
  <sub>Built with ❤️ by <a href="https://github.com/zosmaai">zosmaai</a> · </sub>
  <a href="https://pi.dev">pi.dev</a> · <a href="https://github.com/zosmaai/pi-llm-wiki/issues">Issues</a>
</div>

## Лицензия

MIT
