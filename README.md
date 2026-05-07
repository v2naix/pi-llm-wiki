# @zosmaai/pi-llm-wiki

[![CI](https://github.com/zosmaai/pi-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/zosmaai/pi-llm-wiki/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zosmaai/pi-llm-wiki)](https://www.npmjs.com/package/@zosmaai/pi-llm-wiki)
[![Coverage](https://codecov.io/gh/zosmaai/pi-llm-wiki/branch/main/graph/badge.svg)](https://codecov.io/gh/zosmaai/pi-llm-wiki)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![CodeQL](https://github.com/zosmaai/pi-llm-wiki/actions/workflows/codeql.yml/badge.svg)](https://github.com/zosmaai/pi-llm-wiki/actions/workflows/codeql.yml)

Self-maintaining, Obsidian-compatible knowledge base for [pi](https://pi.dev). Following Andrej Karpathy's LLM Wiki pattern.

## Install

```bash
pi install npm:@zosmaai/pi-llm-wiki
```

## Quick Start

```
/wiki-init "AI Engineering"
```

Drop sources into `raw/`, then:

```
/wiki-ingest
/wiki-query What are the key patterns?
```

## What It Does

| Tool                  | Purpose                                       |
| --------------------- | --------------------------------------------- |
| `wiki_bootstrap`      | Initialize a new wiki vault                   |
| `wiki_capture_source` | Capture URL/file/text into immutable packet   |
| `wiki_ingest`         | Process sources into wiki pages               |
| `wiki_ensure_page`    | Create entity/concept/synthesis/analysis page |
| `wiki_search`         | Search the wiki registry                      |
| `wiki_lint`           | Health check (orphans, gaps, contradictions)  |
| `wiki_status`         | Stats dashboard                               |
| `wiki_rebuild_meta`   | Force metadata rebuild                        |
| `wiki_log_event`      | Record custom event                           |
| `wiki_watch`          | Schedule auto-updates                         |

## Architecture

Four layers with clear ownership:

```
raw/sources/SRC-*/     # Immutable source packets (extension-owned)
wiki/                   # Editable knowledge pages (you + LLM)
meta/                   # Auto-generated registry, backlinks, index, log
.wiki/                  # Config and templates
```

Read [docs/architecture.md](docs/architecture.md) for details.

## Documentation

- [Architecture](docs/architecture.md) — How the four layers work
- [Commands](docs/commands.md) — All slash commands and tools
- [Obsidian Integration](docs/obsidian.md) — Vault setup and recommended plugins
- [Configuration](docs/configuration.md) — Wiki modes, topics, settings
- [API](docs/api.md) — Extension tool reference

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributors

[![Contributors](https://img.shields.io/github/contributors/zosmaai/pi-llm-wiki)](https://github.com/zosmaai/pi-llm-wiki/graphs/contributors)

Thanks to everyone who has contributed to this project:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%">
        <a href="https://github.com/jfraser">
          <img src="https://avatars.githubusercontent.com/u/165964?v=4" width="80" alt="jfraser">
          <br /><sub><b>James Fraser</b></sub>
        </a>
        <br />
        <a href="https://github.com/zosmaai/pi-llm-wiki/issues?q=author%3Ajfraser" title="Bug reports & PRs">🐛</a>
      </td>
    </tr>
  </tbody>
</table>
<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

## Stargazers

[![Stars](https://img.shields.io/github/stars/zosmaai/pi-llm-wiki?style=social)](https://github.com/zosmaai/pi-llm-wiki/stargazers)

If you find this project useful, please give it a star on GitHub!

---

<div align="center">
  <sub>Built with ❤️ by <a href="https://github.com/zosmaai">zosmaai</a></sub>
</div>

## License

MIT
