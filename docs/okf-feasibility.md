# 支持 Google Open Knowledge Format（OKF）的可行性评估

> **历史文档（非规范性）：** 本文最初在“需要兼容既有 vault”的假设下推荐导出 adapter，后续产品决策已否定该方案。最终权威要求见 [`specifications/native-okf.md`](specifications/native-okf.md)。本文仅保留为方案比较和早期调研记录；其中的建议、工作量和实施阶段均不再定义产品要求。

> 调研日期：2026-07-21  
> 结论对象：`@zosmaai/pi-llm-wiki` 当前 `main`（`d89a1c7`）  
> OKF 基线：v0.1 Draft

## 结论

**可行，而且项目与 OKF 天然高度接近。** 两者都源自 Karpathy 的 LLM Wiki 模式，核心模型都是“一个概念一个 Markdown 文件 + YAML frontmatter + 目录层级 + 交叉链接”。

但要区分两个目标：

1. **纸面合规**：把 `.llm-wiki/wiki/` 视为 OKF bundle 时，现有页面通常已经具备 OKF v0.1 唯一强制的 `type` 字段，因此接近最低合规线。
2. **真正互操作**：现有 `[[wikilinks]]`、frontmatter 字段、索引和日志格式无法被 Google 参考消费者完整识别；需要转换或调整。

推荐不要立即把内部存储原地切成 OKF，而是在现有知识模型与外部格式之间建立一个 **OKF adapter seam**：先提供确定性的导出与校验，再按需求增加导入。这样不会破坏既有 vault、Obsidian 体验、source packet 和 guardrail。

建议第一阶段新增：

- `wiki_export_okf`：导出到 `.llm-wiki/outputs/okf/`
- `wiki_validate_okf`：同时给出 spec 合规和 Google 参考工具兼容性结果
- 一个独立的 `lib/okf.ts` 深模块，隐藏字段补全、链接转换、索引/日志生成等实现

MVP 工作量预计为 **2–4 个工程日**；带导入、冲突策略、MCP 暴露、迁移与完整文档的双向支持约 **1–2 周**。这是基于当前代码结构和测试规模的粗估，不包含上游 OKF 草案发生破坏性变化的返工。

## OKF v0.1 的关键要求

Google Cloud 将 OKF 定义为 vendor-neutral 的知识交换格式，bundle 是一个 Markdown 目录树，每个 concept 是一个 UTF-8 Markdown 文件，路径（去掉 `.md`）就是 Concept ID。[Google Cloud announcement](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) [OKF SPEC §2–4](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)

### 强制要求

按规范 §9，一个 bundle 合规需要：

- 除保留文件外，每个 `.md` 都有可解析的 YAML frontmatter；
- 每个 concept 都有非空 `type`；
- `index.md`、`log.md` 存在时遵守规定格式。

`index.md` 和 `log.md` 是保留文件，不是 concept。普通 `index.md` 没有 frontmatter；规范 §11 又允许根 `index.md` 用 frontmatter 声明 `okf_version: "0.1"`。[OKF SPEC §3, §6, §7, §9, §11](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)

### 推荐约定

- 推荐字段：`title`、`description`、`resource`、`tags`、`timestamp`；
- 内部关系使用标准 Markdown 链接，规范推荐 bundle-root absolute 链接，也允许相对链接；
- 外部依据推荐集中在文末 `# Citations`；
- 每级目录可生成 `index.md`，用于 progressive disclosure；
- `log.md` 按 `YYYY-MM-DD` 倒序分组。

### 草案与参考实现的不一致

OKF 目前是 **v0.1 Draft**，规范与 Google 同仓库参考实现存在两处重要偏差：

1. 规范只强制 `type`，但参考实现的 `OKFDocument.validate()` 强制 `type`、`title`、`description`、`timestamp` 四个字段。[reference_agent/bundle/document.py](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/src/reference_agent/bundle/document.py)
2. 规范推荐 `/tables/users.md` 形式的 bundle-relative absolute 链接；参考 visualizer 的提取器却跳过以 `/` 开头的链接，只识别文件相对 `.md` 链接。[OKF SPEC §5](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) [reference viewer generator.py](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/src/reference_agent/viewer/generator.py)

因此本项目不应只提供一个布尔 `valid`。校验结果应区分：

- `specConformant`：严格按 v0.1 规范；
- `referenceCompatible`：可被当前 Google 参考工具有效消费；
- warnings：推荐字段、不可识别链接等软问题。

## 当前项目映射

| OKF 概念 | pi-llm-wiki 当前实现 | 适配程度 |
|---|---|---|
| Knowledge Bundle | `.llm-wiki/wiki/` 最适合作为 bundle；不能把整个 `.llm-wiki/` 当 bundle | 高 |
| Concept | `wiki/{sources,entities,concepts,...}/*.md` | 高 |
| Concept ID | 当前 registry ID 正是去掉 `.md` 的相对路径，如 `concepts/rag` | 很高 |
| YAML frontmatter | 所有内置页面生成器都写 `type` | 高 |
| 可扩展类型 | 已有 source/entity/concept/synthesis/analysis/requirement/skill/case | 高 |
| 交叉链接 | 使用 `[[folder/page]]`，不是 OKF 标准 Markdown 链接 | 低 |
| Citation | 使用 `[[sources/SRC-*]]`，通常没有 `# Citations` | 中低 |
| Index | `meta/index.md` 是全局、wikilink 格式；不在 bundle 内，也没有逐目录索引 | 低 |
| Log | `meta/log.md` 由 JSONL 生成，但不是 OKF 的日期倒序格式 | 中低 |
| 原始证据 | `raw/sources/SRC-*` source packet 比 OKF 要求更强，但不应直接进入 bundle | 可保留为私有扩展 |
| 搜索/回链 | `registry.json`、`backlinks.json` 是本地生成元数据 | 可保留，不属于 bundle |
| Obsidian | wikilinks 原生友好；标准 Markdown 链接也可被 Obsidian 使用 | 可兼容 |

### 为什么 bundle root 必须是 `wiki/`

如果把整个 `.llm-wiki/` 作为 OKF bundle：

- `WIKI_SCHEMA.md`、模板 Markdown 和 `raw/**/extracted.md` 都会被视为 concept；
- 它们通常没有 frontmatter 或没有 `type`，直接违反 §9；
- `meta/index.md`、`meta/log.md` 会触发保留文件语义，但当前格式不完全匹配 OKF。

把 `.llm-wiki/wiki/` 作为逻辑 bundle 可以避开这些冲突，同时保留现有四层架构。

## 三种改造方案

### 方案 A：原地把 `wiki/` 改成原生 OKF

所有页面生成器直接写推荐字段和标准 Markdown 链接；metadata 同时解析 Markdown 链接。

**优点**

- 无导出副本，知识只有一个真源；
- 新 vault 可以直接被 OKF 消费者读取；
- 长期概念最简单。

**缺点**

- 会改变现有 vault 和提示词的链接约定；
- source citations、lint、backlinks、recall、ingest、retro、observation、trajectory 都要同步修改；
- 老 vault 需要迁移，第三方手写页面仍可能产生混合链接；
- 被 v0.1 草案细节绑定，返工面大。

**判断**：不适合作为第一步。

### 方案 B：确定性 OKF 导出 adapter（推荐）

内部格式不变，导出时生成独立 bundle：

```text
.llm-wiki/outputs/okf/
├── index.md
├── log.md
├── sources/
├── entities/
├── concepts/
├── syntheses/
├── analyses/
├── requirements/
├── skills/
└── cases/
```

adapter 负责：

- 保留 Concept ID 和生产者自定义 frontmatter；
- 补齐 `title`、单句 `description`、ISO 8601 `timestamp`；
- 将 `[[concepts/foo|Foo]]` 转成目标文件相对的 `[Foo](../concepts/foo.md)`；
- 生成逐目录 `index.md`；
- 从 `events.jsonl` 生成 OKF `log.md`；
- 可选生成 `# Citations`，链接到 bundle 内的 source concepts；
- 输出结构化校验报告。

**优点**

- seam 清晰，所有 OKF 草案变化集中在一个深模块；
- 零破坏、易测试、易回滚；
- 可以针对“规范”与“参考实现”分别兼容；
- 现有 Pi 工具、MCP、Obsidian 和 guardrail 无须先重构。

**缺点**

- 导出目录是派生副本，需要处理陈旧状态；
- 外部编辑不能自动回写；
- 大 vault 导出有额外 I/O，但可通过原子目录替换和增量构建优化。

**判断**：风险最低、交付价值最高。

### 方案 C：双向 import/export 格式层

抽象统一的 `KnowledgeDocument`，内部 vault 和 OKF 都是 adapter，并提供双向同步。

**优点**

- 可消费外部 OKF bundle，也可输出；
- 长期最适合定位成通用知识工具。

**缺点**

- 导入时必须定义 ID 冲突、删除、未知字段、链接、source provenance、不可变 raw packet 等语义；
- “OKF concept 是否等于可信 source”不是格式能回答的问题；
- 双向同步很容易引入两个真源。

**判断**：有明确外部 OKF 导入需求后再做，不应与 MVP 捆绑。

## 推荐模块设计

建议把 seam 放在“内部 canonical pages → 可分发 bundle”处，而不是散落到每个页面生成器中。

```ts
interface OkfBundleModule {
  exportBundle(input: {
    vault: VaultPaths;
    outputDir: string;
    linkStyle?: "relative" | "bundle-absolute";
  }): Promise<OkfExportResult>;

  validateBundle(bundleDir: string): Promise<OkfValidationResult>;
}
```

这是一个深模块：两个入口隐藏页面遍历、frontmatter 归一化、链接解析与重写、描述推导、逐级索引、日志转换、原子写入和诊断。调用方只需要知道输入路径、输出路径和结果，不需要理解 OKF 的草案差异。

建议新增文件：

- `extensions/llm-wiki/lib/okf.ts`：纯转换、导出、校验；使用 `node:fs/promises`
- `test/okf.test.ts`：fixture 驱动的模块级测试
- `prompts/wiki-export-okf.md`（可选）
- `docs/okf.md`：用户文档

在 `tools.ts` 仅注册薄调用入口，不把转换逻辑放进去。MCP 是否暴露导出工具可以放到第二阶段，以免复制现有 MCP 实现中的 vault/path 逻辑。

## 实施阶段

### Phase 1：互操作导出 MVP

1. 定义 `.llm-wiki/wiki/` 为逻辑 OKF bundle 源。
2. 实现 frontmatter 归一化：
   - `updated` / `observed_at` / `captured` → `timestamp`；
   - H1 → `title`；
   - frontmatter `description` 或正文首个有效段落 → `description`；
   - 原字段全部保留。
3. 实现 wikilink 到相对 Markdown 链接的转换；默认用相对链接以兼容当前 Google visualizer。
4. 生成逐目录 `index.md` 和根 `log.md`。
5. 添加 `wiki_export_okf` 与 `wiki_validate_okf`。
6. 用 Google 示例/参考消费者做兼容性 fixture 测试。

**验收标准**：导出 bundle 通过项目内 spec validator；每个 concept 能被 Google `OKFDocument.parse()` 读取；visualizer 能形成预期节点和边。

### Phase 2：提升内部格式质量

- 所有新页面默认写 `title`、`description`、`timestamp`；
- `extractWikilinks()` 扩展为统一的 internal-link extractor，同时识别 wikilink 和 `.md` 链接；
- lint 增加 OKF compatibility profile；
- 配置 `llm-wiki.okf.autoExport`，默认关闭，metadata rebuild 后可后台刷新导出。

这一步会减少导出时推导，但仍不要求老 vault 迁移。

### Phase 3：可选导入

先实现一次性 `wiki_import_okf`，不要直接做双向同步：

- 外部 concept 进入 canonical `wiki/`，保留未知 frontmatter；
- 标准 Markdown 内链转成内部链接模型；
- 导入 bundle 本身先作为一个 immutable source packet 留档，确保 provenance；
- 冲突默认拒绝或生成报告，不静默覆盖。

## 主要风险

1. **v0.1 草案漂移**：通过单一 adapter seam 和版本化导出器隔离。
2. **规范与参考实现不一致**：同时报告 spec 与 reference compatibility；默认输出采用更严格的四字段集合和相对链接。
3. **描述推导质量**：导出必须确定性，不应为每页调用 LLM；优先 frontmatter，其次首段，最后标题兜底。
4. **YAML 解析能力**：当前 `parseFrontmatter()` 是轻量解析器，不支持完整 YAML。OKF 声明使用 YAML，导入/round-trip 需要完整 YAML parser；仅导出现有受控页面时可先沿用受限模型，但校验外部 bundle 时不够。
5. **链接转换**：需要跳过代码块、图片和外部链接，并正确计算跨目录相对路径；不能只做全局正则替换。
6. **派生目录陈旧**：导出使用临时目录构建后原子替换，并在结果中写 source registry hash/更新时间。
7. **source provenance**：OKF 的 citation 是软约定，不能替代本项目 immutable source packet；不要为了“原生 OKF”删除 raw 层。

## 最终建议

采用 **方案 B**，把 OKF 定位为本项目的可分发格式，而不是立即替换内部工作格式：

- 内部继续保留四层 vault、source packets、guardrails、wikilinks 和生成 metadata；
- `.llm-wiki/wiki/` 是逻辑知识 bundle；
- `.llm-wiki/outputs/okf/` 是可交换、可验证的物化视图；
- 先导出，后导入；先兼容 v0.1 参考生态，再考虑原生化。

这条路线既能快速宣称并验证“支持 OKF”，又保留 pi-llm-wiki 相比基础 OKF 更有价值的能力：不可变来源、自动摄取、召回、lint、guardrail、trajectory 和后台维护。

## 一手资料

- [Open Knowledge Format v0.1 Specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
- [Google Cloud：How the Open Knowledge Format can improve data sharing](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing)
- [GoogleCloudPlatform/knowledge-catalog OKF README](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/README.md)
- [Google OKF reference document implementation](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/src/reference_agent/bundle/document.py)
- [Google OKF reference index generator](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/src/reference_agent/bundle/index.py)
- [Google OKF reference visualizer](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/src/reference_agent/viewer/generator.py)
