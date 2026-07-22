# OKF v0.1 规范性要求与版本语义核实

> 调研对象：GoogleCloudPlatform/knowledge-catalog 的 `okf/SPEC.md`  
> 固定基线：commit [`ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a`](https://github.com/GoogleCloudPlatform/knowledge-catalog/commit/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a)（2026-06-12，`OKF initial commit`）  
> 文档自称：**Version 0.1 — Draft**  
> 调研日期：2026-07-21

## 结论摘要

OKF v0.1 的硬性合规面很小：bundle 是 Markdown 目录树；除 `index.md`、`log.md` 外的每个 `.md` 都是 Concept，必须有可解析的 YAML frontmatter 和非空 `type`；若 reserved document 存在，则必须符合其规定结构。`index.md`、`log.md`、其他推荐字段、内部链接和 Citations 均不是必需项。

规范刻意要求消费者宽容：不得因缺少可选字段、未知 `type`、未知扩展字段、broken link 或缺少 `index.md` 而拒绝 bundle。生产者可以增加字段，round-trip 消费者应语义保留未知字段。

版本声明本身也是可选的，只能放在 bundle 根 `index.md` 的 frontmatter 中。minor 被定义为向后兼容增加，major 可破坏兼容；遇到未知声明版本的消费者应 best-effort consumption，而不是直接拒绝。规范没有定义生产者升级流程、弃用期、版本范围、patch 版本、能力协商或“原生支持”的持续判定规则。

## 术语与身份

规范定义：

- **Knowledge Bundle**：自包含、分层的 knowledge documents 集合，也是分发单元。
- **Concept**：bundle 内一个知识单元，由一个 Markdown 文档表示。
- **Concept ID**：Concept 文件相对 bundle 的路径去掉 `.md` 后缀；如 `tables/users.md` → `tables/users`。
- **Frontmatter**：文件顶部、由独占一行的 `---` 包围的 YAML metadata block。
- **Body**：frontmatter 后的全部内容。
- **Link**：Concept 之间的标准 Markdown 链接。
- **Citation**：从 Concept 指向支持正文主张的外部来源的链接。

原文：[§2 Terminology, L50-L69](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L50-L69)。

规范没有进一步定义路径规范化、`.`/`..`、符号链接、大小写、Unicode normalization、URL encoding 或文件系统边界。因此，Concept ID 的稳定性只明确到“bundle-relative path 去 `.md`”这一层。

## 逐项规范要求

以下按 RFC 2119 风格关键词归类。OKF 文本使用 MUST / SHOULD / MAY，但没有显式引用 RFC 2119/8174；因此这里保留原词，不额外扩大其强度。

### MUST / MUST NOT

| 主体 | 要求 | 合规含义与证据 |
|---|---|---|
| 生产者 / bundle | `index.md`、`log.md` 在目录树任意层级均是 reserved filenames，**MUST NOT** 用作 Concept 文档。 | 所有其他 `.md` 才是 Concept。[§3.1, L95-L106](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L95-L106) |
| Concept | 每个 Concept 是 UTF-8 Markdown，文件开头必须有由独占行 `---` 定界的 YAML frontmatter，之后是 Markdown body。 | §4 使用陈述式 “Every concept … It has two parts”；§9 将 parseable frontmatter 纳入合规判定。[§4, L114-L121](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L114-L121)、[§9, L341-L349](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L341-L349) |
| Concept frontmatter | `type` 必须存在且非空。 | §4.1 称其为唯一 REQUIRED 字段；§9 再次把 non-empty `type` 列为合规条件。[§4.1, L122-L146](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L122-L146)、[§9, L343-L348](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L343-L348) |
| `log.md` | 日期 heading **MUST** 使用 ISO 8601 `YYYY-MM-DD`。 | [§7, L298-L318](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L298-L318) |
| reserved documents | `index.md`、`log.md` 一旦存在，就必须分别遵守 §6、§7 所述结构。 | §9 的第三个合规条件。[§9, L341-L349](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L341-L349) |
| 消费者 | 未知 `type` 必须被宽容处理，通常作为 generic concept。 | [§4.1, L140-L150](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L140-L150) |
| 消费者 | 必须容忍 broken internal link；不存在的目标不使链接或 bundle malformed。 | [§5.3, L257-L267](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L257-L267) |
| 消费者 | 不得仅因缺少可选字段、未知 `type`、未知扩展字段、broken links 或缺少 `index.md` 拒绝 bundle。 | [§9, L351-L364](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L351-L364) |

### SHOULD / SHOULD NOT

| 主体 | 建议 | 证据 |
|---|---|---|
| `type` 生产者 | 选择描述性、可自解释的值；不存在中央注册表。 | [§4.1, L140-L150](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L140-L150) |
| Concept 作者 | 正文优先使用 headings、lists、tables、fenced code blocks 等结构化 Markdown。 | [§4.2, L164-L178](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L164-L178) |
| Concept 作者 | 适用时使用有约定含义的 `# Schema`、`# Examples`、`# Citations` headings。 | [§4.2, L164-L178](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L164-L178) |
| round-trip 消费者 | 语义保留未知 frontmatter keys，不因未知字段拒绝文档。 | 原文为 “SHOULD preserve unknown keys when round-tripping and SHOULD NOT reject”。[§4.1, L160-L162](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L160-L162) |
| `index.md` 生产者 | 条目包含所链接 Concept frontmatter 中的 `description`。 | [§6, L271-L295](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L271-L295) |
| Concept 作者 | 有外部材料支持正文主张时，在文末编号 `# Citations` 下列出来源。 | [§8, L322-L337](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L322-L337) |
| 消费者 | 除 §9 三项硬条件外，把其他约束当作 soft guidance。 | [§9, L351-L364](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L351-L364) |
| 未知版本消费者 | 应尝试 best-effort consumption，而不是拒绝 bundle。 | [§11, L382-L396](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L382-L396) |

### MAY / 可选能力

| 主体 | 许可 | 证据 |
|---|---|---|
| bundle | 可作为 Git repo、tar/zip 或更大 repo 的子目录分发；Git repo 仅为推荐。 | [§3, L71-L93](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L71-L93) |
| frontmatter | `title`、`description`、`resource`、`tags`、`timestamp` 都可省略。`timestamp` 表示 last meaningful change 的 ISO 8601 datetime。 | [§4.1, L122-L162](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L122-L162) |
| `title` 消费者 | 缺少 `title` 时可从文件名推导。 | [§4.1, L151-L159](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L151-L159) |
| frontmatter 生产者 | 可添加任意 producer-defined keys。 | [§4.1, L160-L162](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L160-L162) |
| Concept | 可用标准 Markdown 链接连接 Concept。支持 `/` 开头的 bundle-root relative 形式和标准文件相对形式；前者是规范推荐形式。 | [§5, L233-L255](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L233-L255) |
| `index.md` | 任意目录（包括 bundle root）可有一个；生产者可生成，消费者可在缺失时即时合成。 | [§6, L271-L295](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L271-L295) |
| `log.md` | 任意层级可有一个，记录该 scope 的更新历史。 | [§7, L298-L318](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L298-L318) |
| Citations | 可使用绝对 URL、bundle-relative path，或指向作为 first-class OKF Concepts 的 `references/` 子目录。 | [§8, L322-L337](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L322-L337) |
| bundle version | 可在 bundle 根 `index.md` 的 frontmatter 中声明 `okf_version: "0.1"`；这是唯一允许 `index.md` 含 frontmatter 的位置。 | [§11, L382-L396](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L382-L396) |

## Reserved documents 的精确边界

### `index.md`

- 可出现在任意目录；缺失不影响合规。
- 用于 progressive disclosure，枚举目录内容。
- §6 原则上说“contain no frontmatter”，body 使用一个或多个按 heading 分组的 section；示例条目是 Markdown 列表链接，可包含短描述。
- 唯一例外是根 `index.md` 可以有仅用于版本声明的 frontmatter。
- 规范没有规定 section heading 级别是否必须是 H1、允许哪些额外正文、子目录是否必须列出、排序、空目录、重复条目、生成幂等或删除规则。

证据：[§6, L271-L295](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L271-L295)、[§11, L392-L396](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L392-L396)。

### `log.md`

- 可出现在任意层级；缺失不影响合规。
- 内容是 newest-first、按日期分组的 flat list。
- 日期 heading 必须为 `YYYY-MM-DD`。
- entry 是 prose，开头粗体动作词只是 convention。
- 规范没有定义空日志、同日条目排序、时区、事件身份、并发追加、去重或从何种 authority 生成。

证据：[§7, L298-L318](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L298-L318)。

## 链接、关系与 Citations

- 规范只把**标准 Markdown 链接**定义为 Concept 关系表示；没有定义 wikilink。
- 支持 `/path/file.md`（bundle-root relative，推荐）和 `./other.md` 等文件相对链接。
- A → B 表示一个 directed、untyped relationship；关系类型来自 surrounding prose。
- broken target 被明确允许，消费者必须容忍。
- Citations 是外部主张来源的软约定，但其目标也可以是 bundle 内路径或 `references/` 下的 Concept。

证据：[§2, L63-L69](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L63-L69)、[§5, L233-L267](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L233-L267)、[§8, L322-L337](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L322-L337)。

规范未明确 anchors、query strings、URL encoding、图片语法、reference-style links、HTML links、代码块内伪链接、越界路径、目录链接和重复边是否构图，也没有说明 Citation 内部链接是否同时构成普通关系边。这些必须由项目 contract 或特定消费者 profile 补充，不能冒充 OKF v0.1 要求。

## Timestamp 与未知字段

### Timestamp

`timestamp` 是可选推荐字段，原文语义是 “ISO 8601 datetime of last meaningful change”。规范没有定义 meaningful change、由谁更新、是否必须 UTC、允许哪些 ISO 8601 精度/offset、YAML timestamp scalar 与字符串是否等价，也没有授权使用文件 mtime 猜测它。因此任何更严格责任模型均属于生产者 contract，而非 OKF conformance。

证据：[§4.1, L151-L159](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L151-L159)。

### 未知字段

生产者可以加入任意额外键；消费者不应因未知字段拒绝文档；进行 round-trip 时应保留未知键。这里要求的是字段语义保存，不是注释、字段顺序、引号风格或空白的文本级保真；规范也没有定义修改冲突。

证据：[§4.1, L160-L162](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L160-L162)、[§9, L351-L360](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L351-L360)。

## Conformance 的精确判定

规范给出的充分且必要清单只有三项：

1. 每个 non-reserved `.md` 有 parseable YAML frontmatter；
2. 每个 frontmatter 有 non-empty `type`；
3. present reserved filenames 符合 §6/§7。

证据：[§9, L341-L364](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L341-L364)。

由此可得：

- 空目录树没有违反任何逐文件条件；规范未明确说空 bundle 是否有意义，但按三项清单应是 vacuously conformant。
- 没有 `index.md`、`log.md`、链接、Citations、title、description、resource、tags 或 timestamp 仍可 conformant。
- broken links 不影响 conformance。
- 更严格的项目写入要求可以存在，但必须和 **OKF Conformance Profile** 分开报告。

## 版本语义

规范自称 v0.1 Draft，并定义未来版本为 `<major>.<minor>`：

- minor：向后兼容增加，如新 optional fields、新 conventional headings；
- major：可能作 breaking changes，如重命名 required fields、改变 reserved filenames；
- bundle 的 `okf_version` 声明是 MAY，不声明仍可 v0.1 conformant；
- 声明只能出现在根 `index.md` frontmatter；
- 不认识声明版本的消费者 SHOULD best-effort consume，而不是拒绝。

证据：[标题, L1-L4](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L1-L4)、[§11, L382-L396](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L382-L396)。

未定义项包括：patch 版本、pre-release 标记、版本范围、多版本声明、缺失声明时的检测、minor 向后兼容由谁验证、弃用窗口、消费者何时可以停止 best-effort、以及上游变化后“native OKF support”声明如何续期。它们都需要项目自己的持续升级契约。

## 会影响本项目声明的歧义与张力

1. **`index.md` frontmatter 的表面冲突。** §6 说 index files contain no frontmatter；§11 又明确允许 bundle-root `index.md` frontmatter。应按 §11 的显式唯一例外解释，而不是判根版本声明不合规。
2. **`type` 的类型边界不完整。** §4.1 称它是 short string，§9 只写 non-empty `type`。规范没有说明 YAML number、list、mapping 或 whitespace-only string 是否算 non-empty。项目 validator 应在自身 contract 中明确要求非空字符串，同时把这项额外严格性标明。
3. **“parseable YAML”没有解析 profile。** YAML 版本、schema、duplicate keys、aliases、merge keys、自定义 tags 和多文档 stream 都未规定。不同 parser 可能对同一文件得出不同 conformance 结果。
4. **Reserved structure 不足以机械判定。** §9 要求“follows the structure”，但 §6/§7 多用描述和示例，没有完整 grammar；空文件、额外 sections、嵌套列表等边界没有唯一答案。
5. **Self-contained 与外部 Citation 并不等于离线封闭。** Bundle 被称为 self-contained，但 Citation 明确可指向外部 URL，broken internal link 也允许。因此 self-contained 应理解为分发单元边界，不应推导为所有依赖必须内嵌。
6. **根绝对链接“推荐”但并非唯一兼容形式。** 规范推荐 `/...`，同时支持 relative links；任何选择相对链接的项目仍可 conformant。具体 reference tool 是否消费两种形式是独立兼容性问题。
7. **未知字段 preservation 是 SHOULD。** 不保留未知键可能违反推荐消费者行为，但 §9 未把它列入硬性 bundle conformance。应将 round-trip contract 和静态 bundle conformance 分开。
8. **版本声明与 index 可选性形成检测缺口。** 缺少根 `index.md` 合法，`okf_version` 又是可选，因此消费者不能总能从 bundle 内确定目标版本。
9. **规范没有定义 producer conformance。** §9 只定义 bundle 是否 conformant；“工具支持 OKF”“原生 OKF producer”“reference compatible”都不是规范内正式声明，必须由本项目分别定义。

## 对后续决策票的约束

- **三层兼容性声明**必须以本文件的三项 §9 判据作为 OKF v0.1 profile，不能把 reference validator 的额外要求说成 OKF MUST。
- **Canonical bundle 边界**必须让 bundle 内所有 non-reserved `.md` 接受 Concept 判定；私有 Markdown 若无 frontmatter/`type` 必须放在 bundle 外。
- **YAML contract**需自行固定 YAML parser/profile、`type` 字符串边界及未知键语义保存方式。
- **链接 contract**需自行定义 anchors、encoding、图片、代码、越界和图去重；OKF 只提供两种基本路径形式与 broken-link 宽容要求。
- **Timestamp contract**需自行定义 meaningful change 和责任主体；mtime 推断不是上游要求。
- **Reserved-document 策略**可选择不生成，也可生成在任意层级；一旦生成才承担结构合规。
- **升级契约**必须补上版本检测、未知版本诊断、评估和声明更新流程；上游只给 major/minor 的粗粒度语义。

## 一手来源

- [固定版本 OKF v0.1 SPEC](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md)
- [引入该规范的固定 commit](https://github.com/GoogleCloudPlatform/knowledge-catalog/commit/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a)
