# OKF Reference Visualizer：文档发现与链接图语义核实

## 结论摘要

本报告以以下两个不可变版本为准：

- **实现基线**：`GoogleCloudPlatform/knowledge-catalog@d44368c15e38e7c92481c5992e4f9b5b421a801d`
- **规范基线**：`okf/SPEC.md@ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a`（OKF v0.1 Draft）

核心结论：

1. viewer 递归发现小写 `*.md`，只排除 `index.md`；OKF v0.1 同时保留 `index.md` 和 `log.md`，因此 `log.md` 会被错误显示为 `Unknown` Concept，并可能成为边的源点。
2. viewer 没有用 Markdown parser 构图，而是在原始 body 上运行 `\]\(([^)\s]+\.md)(?:#[A-Za-z0-9_\-]*)?\)`。它只覆盖一小部分 inline link，同时把 image、inline code、fenced code 里的相同字面量误判成关系。
3. **图与详情页的内部链接判定几乎互补而非一致**：图只接受相对 `.md` 目标，并主动丢弃以 `/` 开头的 bundle-root 链接；详情页只把无 anchor 的 `/path.md` 改写成内部导航，相对链接全部标成 external。于是正常链接没有一种形式能同时稳定地产生图边并在详情页内部跳转。
4. OKF v0.1 明确支持相对链接和以 `/` 开头的 bundle-root 链接，并推荐后者；当前图遗漏规范推荐形式，是最主要的规范偏差。
5. broken、out-of-bundle、external 和 self link 都不会形成边；同一有向 `(source, target)` 会去重，反向边保留。这个总体策略与“有向、无类型关系图”基本相符，但边 ID 的字符串拼接存在碰撞可能。
6. `# Citations` 没有特殊解析。所有入边都在详情页统一标为 **Cited by**，把一般关系误称为引用；外部 Citation 不入图，相对内部 Citation 可入图，bundle-root Citation 则因上述缺陷不入图。
7. 固定版本的 `test_viewer.py` 只覆盖相对链接、缺失目标、`index.md` 和颜色；没有覆盖 `log.md`、bundle-root、anchor、Markdown 语法边界、代码、图片、重复/自链、YAML 失败或详情页改写，因此无法约束上述语义。

## 1. 规范基准

OKF v0.1 的相关规则如下：

- Concept 是单个 Markdown 文档，Concept ID 是相对 bundle 的文件路径去掉 `.md`。[SPEC：术语][spec-terms]
- `index.md` 与 `log.md` 在任意层级均为 reserved filenames，不能作为 Concept；其他 `.md` 才是 Concept 文档。[SPEC：reserved filenames][spec-reserved]
- Concept 是 UTF-8 Markdown，文件开头应有可解析的 YAML frontmatter；`type` 是唯一 REQUIRED 字段，未知 type 必须被消费者容忍。[SPEC：Concept 与 frontmatter][spec-frontmatter]
- body 是标准 Markdown，可包含 fenced code；`# Citations` 是有约定语义的标题。[SPEC：body][spec-body]
- Concept 间链接支持两种形式：以 `/` 开头、相对 bundle root 的链接，以及相对当前文档的链接；前者是推荐形式。[SPEC：cross-linking][spec-cross-link]
- Concept A 指向 B 的链接表达一条**有向、无类型关系**；broken link 必须被消费者容忍。[SPEC：link semantics][spec-link-semantics]
- Citation 可以是外部 URL、bundle-root 路径，或指向 `references/` 中一等 Concept 的路径。[SPEC：Citations][spec-citations]
- bundle conformance 要求每个非 reserved `.md` 有可解析 frontmatter 和非空 `type`；消费者仍不得因缺少可选字段、未知 type、未知扩展字段、broken link 或缺少 index 而拒绝整个 bundle。[SPEC：conformance][spec-conformance]

## 2. Concept 发现与 YAML 解析

### 2.1 实际发现算法

`_walk_concepts` 对 `bundle_root.rglob("*.md")` 排序后遍历，只在 basename 严格等于 `index.md` 时跳过；Concept ID 按相对路径去后缀并用 `/` 拼接。[generator.py L69-L95][gen-discovery]

由此得到：

| 输入 | 实际结果 | 与 OKF v0.1 的关系 |
|---|---|---|
| `tables/users.md` | Concept ID `tables/users` | 符合 |
| 任意层级 `index.md` | 不产生节点，也不读取其中链接 | 符合 reserved 语义 |
| 任意层级 `log.md` | 产生 `log` 或 `dir/log` 节点 | **偏差**：规范明确保留 `log.md` |
| `README.md` 等其他 `.md` | 一律尝试作为 Concept | 符合“其他 `.md` 都是 Concept”的字面规则；若无合规 frontmatter，则 bundle 本身不 conformant |
| `UPPER.MD` | 不被发现 | `Path.rglob("*.md")` 的大小写行为依文件系统而定；实现没有扩展名归一化 |

因为 `log.md` 通常没有 frontmatter，固定实现会把它显示成 type `Unknown`、title 为 Concept ID；其正文中匹配到的相对 `.md` 链接还可能产生图边。这不只是多一个节点，也会污染关系图。

### 2.2 YAML parse 的精确行为

viewer 调用 `OKFDocument.parse`，但只捕获 `OKFDocumentError`；解析器行为是：[document.py L22-L47][doc-parse]

1. 第一行 `strip()` 后不是 `---`：**不报错**，全文作为 body，frontmatter 为 `{}`。
2. 第一行是 `---`，但找不到后续 `strip()` 后等于 `---` 的行：抛 `OKFDocumentError`。
3. delimiter 之间交给 `yaml.safe_load`；YAML 错误或结果不是 mapping：抛 `OKFDocumentError`。
4. 空 frontmatter 被 `or {}` 归一为 `{}`。
5. 成功后 body 是 closing delimiter 之后的内容，最多去掉开头一个空行。

`_walk_concepts` 对第 2、3 类错误静默跳过文档；第 1、4 类却照常建节点，并以 `Unknown`、Concept ID、空 description/resource 作为 fallback。[generator.py L76-L94][gen-discovery] viewer 没有调用 `validate()`。虽然同模块把 `type`、`title`、`description`、`timestamp` 列入 required key，[document.py L8][doc-required] 且 `validate()` 会拒绝缺失项，[document.py L56-L61][doc-validate] 但这与 viewer 无关，而且该 required 集合本身比 OKF v0.1 的“只要求 `type`”更严格。

边界影响：

- 文件开头有空行或 UTF-8 BOM 时，首行不等于 `---`，会被当作无 frontmatter Concept，而不是 parse error。
- delimiter 前后有空格会被接受，宽松于“`---` on its own line”的规范措辞。
- 缺失/空 `type` 不会被拒绝或跳过，而是显示为 `Unknown`。这有利于 best-effort 浏览，但掩盖了 bundle 的 conformance 错误。
- 未知 type 被保留并使用默认灰色，符合消费者应容忍未知 type 的要求。[generator.py L32-L45][gen-node]
- 非 list 的 `tags` 被强制包装为单元素字符串 list；可选字段和扩展字段不参与 conformance 校验。
- UTF-8 decode error、I/O error 等不是 `OKFDocumentError`，会中止整个生成，而不是跳过单个文档。

## 3. 链接提取与图构建

### 3.1 两阶段算法

第一阶段 `_extract_links` 在**原始 body 字符串**上运行以下 regex，而不是 Markdown AST：[generator.py L11-L12][gen-regex] 提取、路径解析和去重逻辑见 [generator.py L48-L66][gen-extract]。

```python
r"\]\(([^)\s]+\.md)(?:#[A-Za-z0-9_\-]*)?\)"
```

每个 match 随后按如下规则处理：

1. target 包含 `://` 或以 `/` 开头：跳过。
2. 以当前文档目录为基准做 `Path.resolve()`。
3. resolve 后不能 `relative_to(bundle_root.resolve())`：视为 out-of-bundle，跳过。
4. 去掉末尾 `.md`，按规范化后的 target Concept ID 去重，保留首次出现顺序。

第二阶段 `_build_graph` 只为实际已发现的 target ID 建边；self link 与不存在的 target 被跳过，并再次按 `(source, target)` 去重。[generator.py L98-L126][gen-graph]

### 3.2 标准 Markdown 链接覆盖面

CommonMark 0.30 把 inline link 和 reference link 都定义为标准链接，并允许可选 title；destination 可用 `<...>` 包围，或包含转义/成对括号。[CommonMark：Links][commonmark-links] 固定 regex 并不覆盖完整语法：

| body 字面量 | regex/图结果 | 说明 |
|---|---|---|
| `[x](../b.md)` | target `b`；存在时建边 | 支持的主要形式 |
| `[x](../b.md#h-1)` | target `b`；存在时建边 | anchor 被丢弃 |
| `[x](../b.md "title")` | 不匹配 | 标准 inline link 的 title 未支持 |
| `[x](<../b.md>)` | 不匹配 | angle-bracket destination 未支持 |
| `[x](../b(1).md)` | 不匹配 | 标准允许的 balanced parentheses 未支持 |
| `[x][id]` + `[id]: ../b.md` | 不匹配 | reference link 未支持 |
| `[x](../b.md?q=1)` | 不匹配 | `.md` 后 query 未支持 |
| `](../b.md)` | **匹配** | regex 不要求前导 `[`，可对无效 Markdown 产生假边 |
| `\](../b.md)` | **匹配** | 不理解 Markdown escape |

因此，“标准 Markdown 链接”在 SPEC 中是语法类别；viewer 实际识别的是“正文任意位置出现的特定 `](...md)` 字符串”。

### 3.3 relative 与 bundle-root

- **Relative**：图按当前文档目录 resolve，支持 `./`、`../` 和路径归一化；resolve 后仍须位于 bundle 内。这一部分符合 SPEC。
- **Bundle-root**：`target.startswith("/")` 被明确跳过，所以 `/tables/users.md` 永远不生成边。[generator.py L52-L59][gen-extract]

这与 SPEC 不只是边角差异：以 `/` 开头的形式是明确支持且推荐的形式，[SPEC L233-L255][spec-cross-link]，SPEC 自带示例也主要使用它。结果是 conformant 且采用推荐写法的 bundle 可能显示为一组完全没有边的节点。

`Path.resolve()` 还会规范化 `.`/`..` 并解析已有 symlink；因此通过 symlink 实际落到 bundle 外的目标也会被排除。路径语义依运行平台和文件系统而定。

### 3.4 anchors

regex 仅允许 `.md` 后跟可选的 `#[A-Za-z0-9_-]*`：

- `b.md#heading-1`、`b.md#`：匹配并归一到 `b`。
- `b.md#章节`、`b.md#a%20b`：不匹配。
- `#local-heading`：不匹配，因为没有 `.md`。

图是 Concept 级而不是 heading 级，所以“丢弃合法 document anchor 后仍建到 Concept 的边”是合理策略；问题在于合法 anchor 字符集被 regex 人为缩窄，且详情页又不能内部处理任何带 anchor 的链接（见 §4）。OKF v0.1 没有单独规定 anchor，但其“标准 Markdown”措辞没有给消费者缩窄 fragment 的依据。

### 3.5 URL encoding 与带空格文件名

实现没有 URL decode：`../hello%20world.md` 被视为文件系统字面路径 `hello%20world.md`，不会指向 `hello world.md`。相反，raw space 被 `[^)\s]+` 排除，而标准 Markdown 可用 `<../hello world.md>` 表达带空格 destination；该形式也因 `<`/`>` 不符合 regex 尾部结构而不匹配。[CommonMark L7478-L7491][commonmark-links]

因此：

- 文件名真是 `hello%20world.md`：relative encoded 写法可建边。
- 文件名是 `hello world.md`：`[x](../hello%20world.md)` 与 `[x](<../hello world.md>)` 都不会建边。
- `%2F`、percent-encoded fragment 等同样不会按 URL 语义解码。

### 3.6 images、inline code 与 fenced code

CommonMark image 语法以 `![` 开头，其余结构类似 link；渲染结果是 `<img>`，不是 `<a>`。[CommonMark：Images][commonmark-images] 但 image 中同样包含 `](`，所以 `![alt](../b.md)` 会被 viewer 当作 Concept 关系。

同理，提取发生在 Markdown render 之前且不识别语法上下文，所以以下两种内容也产生假边：

````markdown
`示例：[x](../b.md)`

```md
[x](../b.md)
```
````

CommonMark 明确定义 code span 和 fenced code block 是代码结构，[CommonMark：Code spans][commonmark-code-span] [CommonMark：Fenced code blocks][commonmark-fence]；其中形似链接的文本不应成为渲染后的 anchor。图却会扫描并建边，详情页渲染后也没有对应的可点击链接，造成“图中有关系、正文中看不到链接”的明显错觉。

### 3.7 external、out-of-bundle 与 broken targets

| 类别 | 图语义 |
|---|---|
| `https://host/x.md` 等含 `://` target | 提取阶段跳过 |
| `/x.md` | 也被跳过，但它其实是规范定义的 bundle-root target，不应归为 external |
| `../../outside.md` | resolve 后不在 bundle 内，跳过 |
| bundle 内不存在的 `missing.md` | 第一阶段保留 ID，第二阶段因 `target not in ids` 不建边 |
| `mailto:foo.md` 等不含 `://` 的 scheme | 可能先按本地路径处理，最终通常因无同名 Concept 而不建边 |

broken link 不导致文档或 bundle 被拒绝，符合 OKF 的宽容要求；但输出不会保留 dangling-edge 或诊断信息，用户无法从图中区分“没有关系”和“关系目标尚未写入”。固定测试只断言缺失目标得到空边列表。[test_viewer.py L130-L148][test-broken]

### 3.8 self-links、duplicate edges 与 edge ID

- self link：第二阶段显式跳过。
- 同一 source 多次链接同一 target：第一阶段按规范化 target 去重，第二阶段又按 `(source, target)` 去重，只保留一条。
- `b.md`、`./b.md`、`sub/../b.md` 以及它们的不同受支持 anchor 都会 collapse 到同一 target。
- `A → B` 与 `B → A` 是两条不同的有向边，符合 SPEC 的 directed edge 语义。

OKF v0.1 没有规定 self/duplicate 的图展示；当前 collapse 策略适合 Concept 级无类型图，但会丢失“正文出现次数、所在段落、关系语义”等信息。

另有一个独立碰撞：edge data ID 是 `f"{source}__{target}"`。[generator.py L102-L116][gen-graph] 因 Concept ID 本身可含 `__`，`a__b → c` 与 `a → b__c` 都得到 `a__b__c`。`seen_edges` 认为它们不同，却向 Cytoscape 提供相同 element ID；这不是 duplicate edge 去重，而是序列化 ID 不具单射性。

## 4. 图与详情页的链接语义不一致

详情页把原始 body 交给固定加载的 `marked@12.0.0` 以 GFM 模式渲染，[viz.js L184-L188][viz-render]；模板固定引入 Cytoscape 3.28.1 和 marked 12.0.0。[viz.html L4-L7][viz-template] 然后 `rewriteInternalLinks` 只遍历渲染结果中的 `a[href]`，并仅在以下条件全部满足时改写为内部导航：[viz.js L216-L235][viz-rewrite]

1. `href.startsWith("/")`；
2. `href.endsWith(".md")`；
3. 去掉开头 `/` 和末尾 `.md` 后，恰好存在同 ID 的节点。

否则一律加上 `class="external"`、`target="_blank"`、`rel="noopener"`。

这导致如下矩阵：

| Markdown | 图 | 详情页 |
|---|---|---|
| `[B](../b.md)` | 若 B 存在，建边 | 标为 external，新标签页打开相对 URL；不调用 `showDetail` |
| `[B](/b.md)` | 不建边 | 若 B 存在，内部调用 `showDetail("b")` |
| `[B](../b.md#h)` | 建到 B | external |
| `[B](/b.md#h)` | 不建边 | 因不再以 `.md` 结尾而 external |
| `[B](/b.md)`，但 B 不存在 | 不建边 | external，按站点 origin 的绝对路径打开 |
| `![B](/b.md)` | 不建边 | marked 渲染为 `img`；重写器只看 `a[href]`，不改写 |
| code 中的 `[B](../b.md)` | **可能建假边** | marked 渲染为 code，不产生可重写 anchor |

关键事实是：**relative 是 graph-internal/detail-external；bundle-root 是 graph-ignored/detail-internal。** 这两个层次没有共享一个 target resolver，因而不能向用户提供一致的 OKF 链接语义。

详情页显示的 backlinks 直接由最终图边反向建立；[viz.js L16-L25][viz-backlinks] 点击 backlink 会调用 `showDetail`。所以详情页“Cited by”只反映 regex 识别且成功建图的那部分关系，而不是正文所有标准 Markdown 入链。

## 5. Citations 语义

SPEC 把 Citation 定义为支持正文 claim 的来源，并建议放在文末 `# Citations` 下；Citation target 可为外部 URL、bundle-root 路径或 `references/` Concept。[SPEC L322-L337][spec-citations]

实现完全不解析 heading 或 Citation 编号，后果是：

- 外部 Citation：不形成图边；详情页作为普通 external anchor 打开。这是合理展示，但图没有 citation metadata。
- 相对 `references/foo.md` Citation：若目标存在，会成为普通无类型边。
- 推荐形式 `/references/foo.md`：图因 leading `/` 丢弃，但详情页可内部跳转（仅限无 anchor）。
- 非 Citations 段落中的 join、dependency、普通 mention，以及误识别的 image/code link，都与 Citation 使用完全相同的边结构。
- 模板却把所有图入边统一标题化为 **Cited by**，[viz.html L50-L54][viz-cited-by]，而 SPEC 明确说一般 cross-link 的具体关系由周围 prose 表达、图通常使用无类型边。[SPEC L257-L267][spec-link-semantics]

因此数据模型是“无类型 relationship”，UI 文案却断言为 citation；更准确的标题应是 `Linked from`/“反向链接”，除非未来真的解析并标注 Citation 边。

## 6. 可复现实例

以下 Python 3 脚本逐字复刻固定实现的 regex、relative resolver、去重和最终边过滤；它不读写文件。在 POSIX 路径语义下运行即可复现主要边界：

```python
import re
from pathlib import Path

LINK_RE = re.compile(r"\]\(([^)\s]+\.md)(?:#[A-Za-z0-9_\-]*)?\)")


def extract(body, doc_dir=Path("/bundle/a"), root=Path("/bundle")):
    out, seen = [], set()
    root = root.resolve()
    for match in LINK_RE.finditer(body):
        target = match.group(1)
        if "://" in target or target.startswith("/"):
            continue
        try:
            rel = (doc_dir / target).resolve().relative_to(root).as_posix()
        except ValueError:
            continue
        if rel.endswith(".md"):
            rel = rel[:-3]
        if rel and rel not in seen:
            seen.add(rel)
            out.append(rel)
    return out


cases = {
    "relative+anchor+dedup": "[x](../b.md) [y](../b.md#h-1) [z](./../b.md#)",
    "bundle-root+external+outside": "[root](/b.md) [web](https://e/x.md) [out](../../out.md)",
    "images+inline+fenced": "![img](../b.md) `code [x](../c.md)`\n```md\n[x](../d.md)\n```",
    "encoded+spaced+anchor": "[enc](../hello%20world.md) [space](../hello world.md) [unicode](../b.md#章节) [pct](../b.md#a%20b)",
    "markdown-variants": "[title](../b.md \"T\") [angle](<../b.md>) [ref][id]\n[id]: ../b.md",
    "query+paren+fragment-only": "[q](../b.md?q=1) [p](../b(1).md) [f](#part)",
    "self aliases": "[s](self.md) [s2](./self.md#x)",
}

for name, body in cases.items():
    print(name, [m.group(1) for m in LINK_RE.finditer(body)], extract(body))

ids = {"a/self", "b", "c", "d", "hello%20world"}
links = extract(" ".join(cases.values()))
edges = [("a/self", t) for t in links if t != "a/self" and t in ids]
print("graph links", links)
print("graph edges", edges)
```

预期输出：

```text
relative+anchor+dedup ['../b.md', '../b.md', './../b.md'] ['b']
bundle-root+external+outside ['/b.md', 'https://e/x.md', '../../out.md'] []
images+inline+fenced ['../b.md', '../c.md', '../d.md'] ['b', 'c', 'd']
encoded+spaced+anchor ['../hello%20world.md'] ['hello%20world']
markdown-variants [] []
query+paren+fragment-only [] []
self aliases ['self.md', './self.md'] ['a/self']
graph links ['b', 'c', 'd', 'hello%20world', 'a/self']
graph edges [('a/self', 'b'), ('a/self', 'c'), ('a/self', 'd'), ('a/self', 'hello%20world')]
```

这同时验证了：anchor/path alias 去重、bundle-root 被丢弃、外部/out-of-bundle 被丢弃、image/code 假阳性、URL encoding 不解码、标准 Markdown 变体假阴性，以及 self link 最终被过滤。

## 7. 固定测试实际保证了什么

`test_viewer.py` 的 fixture 全部使用相对 inline links：`../tables/users.md`、`events.md`、`../references/metrics/dau.md` 和 `users.md`。[test_viewer.py L18-L76][test-fixture] 现有断言只保证：

- 生成单文件 HTML，并嵌入 Cytoscape/marked；
- `index.md` 不产生节点；[test_viewer.py L101-L114][test-index]
- 上述四条相对链接形成有向边；[test_viewer.py L117-L127][test-edges]
- 缺失 target 不形成边；[test_viewer.py L130-L148][test-broken]
- 三种内置 type 的颜色；
- bundle root 不存在时抛 `FileNotFoundError`。

未覆盖项恰好包括本 issue 的风险边界：`log.md`、无/坏/非 mapping YAML、空 `type`、bundle-root link、anchor、percent encoding、title/reference/angle/balanced-parentheses link、image、inline/fenced code、out-of-bundle、self/duplicate、edge ID collision、Citations、JS 的 relative/absolute 改写，以及 graph/backlink 一致性。`viz.js` 在该测试文件中没有 DOM 或浏览器级测试。

## 8. 与 OKF v0.1 的偏差清单

| 级别 | 偏差 | 依据与影响 |
|---|---|---|
| 高 | 图丢弃所有 bundle-root links | SPEC 明确支持并推荐 `/path.md`；规范示例会缺边 |
| 高 | 图与详情页使用相反 resolver | relative 只进图，bundle-root 只在详情页内部导航；同一正文呈现出互相矛盾的语义 |
| 高 | `log.md` 被当作 Concept | 违反 reserved filename；还可能引入 `Unknown` 节点和日志链接边 |
| 中 | regex 代替 Markdown parser | 标准 title/reference/angle/balanced-parentheses 等链接漏报；image/code/无效 Markdown 误报 |
| 中 | 所有 backlinks 标为 `Cited by` | SPEC 的一般边是无类型关系；UI 把非 Citation 关系错误命名 |
| 中 | anchor 与 URL encoding 解析不完整 | 合法 fragment 和带空格/编码路径无法稳定映射到 Concept；图和详情页行为再次分裂 |
| 中 | edge ID 可碰撞 | 不同 `(source, target)` 可能产生相同 Cytoscape element ID |
| 低/产品选择 | self 与重复链接 collapse | SPEC 未规定；适合简化 Concept 图，但丢失出现次数和上下文 |
| 低/可观测性 | broken target 静默消失 | 符合“容忍 broken link”，但用户看不到 dangling relation 或诊断 |
| 低/可观测性 | 无 frontmatter/空 type 仍显示为 `Unknown`，坏 YAML 则静默跳过 | best-effort 消费可以接受，但无法从 viewer 判断 bundle conformance |

## 9. 建议的目标语义

若后续修复，应先统一一套共享的“Markdown link → Concept ID”解析语义，再让 graph 与详情页共同消费。最低要求是：

1. 文档发现同时排除任意层级的 `index.md`、`log.md`。
2. 用 Markdown parser/token stream 提取真正的 anchor，排除 image、code span、fenced code，并覆盖 inline/reference link；不要直接扫描 raw body。
3. 一个 resolver 同时接受 `/bundle-root.md` 与相对当前文档的 `../relative.md`，去 fragment、按 URL 规则解码 path 后做 bundle containment 检查。
4. graph 与详情页以同一个 normalized Concept ID 判断 internal/external/broken；anchor 可在 Concept 跳转后进一步定位 heading，至少不应阻止 Concept 级跳转。
5. 图保持 directed、untyped；反向列表称“反向链接/Linked from”。若要展示 Citation，需从 section/context 显式分类，而不是把所有入边命名为 citation。
6. 对 broken/out-of-bundle/external 分开建模或至少输出诊断；继续容忍 broken，但不要把“容忍”等同于“静默删除证据”。
7. edge ID 使用无歧义编码或独立递增 ID，而不是 `source + "__" + target`。
8. 增加参数化 generator 测试和 DOM/浏览器级 link-rewrite 测试，以上述复现矩阵作为最小用例集。

---

## 固定源码引证

[gen-node]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/viewer/generator.py#L32-L45
[gen-regex]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/viewer/generator.py#L11-L12
[gen-extract]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/viewer/generator.py#L48-L66
[gen-discovery]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/viewer/generator.py#L69-L95
[gen-graph]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/viewer/generator.py#L98-L126
[doc-parse]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/document.py#L22-L47
[doc-required]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/document.py#L8
[doc-validate]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/document.py#L56-L61
[viz-render]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/viewer/static/viz.js#L184-L188
[viz-rewrite]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/viewer/static/viz.js#L216-L235
[viz-backlinks]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/viewer/static/viz.js#L16-L25
[viz-template]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/viewer/templates/viz.html#L4-L7
[viz-cited-by]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/viewer/templates/viz.html#L50-L54
[test-fixture]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/tests/test_viewer.py#L18-L76
[test-index]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/tests/test_viewer.py#L101-L114
[test-edges]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/tests/test_viewer.py#L117-L127
[test-broken]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/tests/test_viewer.py#L130-L148

[spec-terms]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L50-L67
[spec-reserved]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L95-L105
[spec-frontmatter]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L114-L162
[spec-body]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L164-L177
[spec-cross-link]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L233-L255
[spec-link-semantics]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L257-L267
[spec-citations]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L322-L337
[spec-conformance]: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L341-L362

[commonmark-fence]: https://github.com/commonmark/commonmark-spec/blob/6af106130d168e923d6008316a6a5681ca5e326d/spec.txt#L1938-L1957
[commonmark-code-span]: https://github.com/commonmark/commonmark-spec/blob/6af106130d168e923d6008316a6a5681ca5e326d/spec.txt#L5869-L5888
[commonmark-links]: https://github.com/commonmark/commonmark-spec/blob/6af106130d168e923d6008316a6a5681ca5e326d/spec.txt#L7448-L7491
[commonmark-images]: https://github.com/commonmark/commonmark-spec/blob/6af106130d168e923d6008316a6a5681ca5e326d/spec.txt#L8518-L8534
