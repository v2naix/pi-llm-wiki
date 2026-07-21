# OKF reference `OKFDocument` 解析、序列化与校验行为

> 调研对象：GoogleCloudPlatform/knowledge-catalog 的 reference agent `OKFDocument`  
> 固定实现基线：commit [`d44368c15e38e7c92481c5992e4f9b5b421a801d`](https://github.com/GoogleCloudPlatform/knowledge-catalog/commit/d44368c15e38e7c92481c5992e4f9b5b421a801d)（2026-06-21）  
> 规范对照基线：commit [`ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a`](https://github.com/GoogleCloudPlatform/knowledge-catalog/commit/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a) 的 OKF v0.1 SPEC  
> 复现实验：Python 3.11+、PyYAML 6.0.3；上游只声明 `pyyaml>=6.0`，没有 lock file  
> 调研日期：2026-07-22

## 结论摘要

reference agent 没有一个实现 OKF v0.1 bundle conformance 的 validator。`OKFDocument` 只有三个彼此分离的操作：`parse()` 识别并用 `yaml.safe_load` 读取 frontmatter，`serialize()` 用 `yaml.safe_dump` 重写文档，`validate()` 只检查四个键的值是否 truthy。生产写入口 `write_concept_doc()` 会调用 `validate()`；读取、index 与 visualizer 路径只 parse，不 validate。

因此它不能作为 OKF v0.1 合规性的 oracle：

- 它比规范**更严格**地要求 `title`、`description`、`timestamp`，而 OKF v0.1 唯一 REQUIRED frontmatter 字段是 `type`。
- 它又比规范**更宽松**地接受 truthy 的任意 YAML 类型作为四个字段的值，不验证 `type` 是字符串，也不验证 `timestamp` 是 ISO 8601 datetime。
- 它不检查 reserved documents、文件身份、UTF-8、Markdown body、链接、citations、未知字段保留责任或 bundle-level 条件。
- 它的 round-trip 是 YAML 数据结构层面的语义 round-trip，不是文本 round-trip；注释、重复键、merge key、锚点表达、引号、flow/block style、换行和空白都会丢失或规范化。
- 当前 parser 还有一个边界缺陷：它对每行先 `strip()` 再寻找结束 `---`，所以 YAML literal block 内缩进的 `  ---` 也会被误判为 frontmatter 结束符。

后续规范应把 reference `OKFDocument` 定义为一个有已知差异的 **Reference Tool Compatibility Profile**，不能把它的四键规则或 PyYAML 行为提升为 **OKF Conformance Profile**。

## 实现表面与调用边界

`OKFDocument` 是一个只有 `frontmatter: dict` 与 `body: str` 的 dataclass。固定源码见 [`document.py` L17-L20](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/document.py#L17-L20)。

它把以下四个键声明为“required”：

```python
("type", "title", "description", "timestamp")
```

证据：[`document.py` L8](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/document.py#L8)。

但 `validate()` 并不是 parser 的自动阶段，也不是 bundle validator。生产写入口先构造 `OKFDocument`，再显式调用 `validate()`，失败时拒绝写入；随后才 serialize 和落盘。证据：[`bundle_tools.py` L73-L108](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/tools/bundle_tools.py#L73-L108)、[`bundle_tools.py` L156-L162](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/tools/bundle_tools.py#L156-L162)。已有文档读取只调用 `parse()`，不调用 `validate()`；证据：[`bundle_tools.py` L56-L70](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/tools/bundle_tools.py#L56-L70)。

`write_concept_doc()` 还会在缺失或 falsey 时自动填当前 UTC `timestamp`，但这发生在 `OKFDocument.validate()` 之外；传入非空但无效的 timestamp 不会被修复或拒绝。证据：[`bundle_tools.py` L92-L99](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/tools/bundle_tools.py#L92-L99)。

## `parse()` 的精确行为

源码：[`document.py` L22-L47](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/document.py#L22-L47)。

### 文档与 delimiter 发现

1. 使用 Python `str.splitlines()` 拆行，因此输入换行风格不会保留。
2. 只有首行满足 `lines[0].strip() == "---"` 才认为存在 frontmatter。
3. 空文档、首行不是 delimiter、首行有 UTF-8 BOM，都会被当成“无 frontmatter”：返回空 mapping，并把原文本完整放入 body；parse 本身不报错。
4. delimiter 前后空格被接受，例如 `  ---  `。
5. 从第二行开始，第一个满足 `line.strip() == "---"` 的行就是结束 delimiter。
6. 找不到结束 delimiter 时抛 `OKFDocumentError("Unterminated YAML frontmatter block")`。
7. 因为结束检测会 strip，YAML block scalar 内缩进的 `  ---` 也会提前结束 frontmatter。这可能把本来完整的 YAML 静默拆成较小 mapping 与 body，而不是产生 YAML error。
8. 结束 delimiter 后若 body 恰好以一个空行开头，只删除这一个空行；其他空行归 body。

上游测试只覆盖了“无 frontmatter 作为 body”和“未终止时报错”：[`test_document.py` L33-L43](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/tests/test_document.py#L33-L43)。BOM、空白 delimiter 和 block-scalar delimiter 均无回归测试。

### YAML 接受面

frontmatter 文本交给 `yaml.safe_load()`；结果 falsey 时经 `or {}` 变成空 mapping，之后必须是 Python `dict`，否则拒绝。PyYAML 异常被包装为 `OKFDocumentError`。证据：[`document.py` L36-L42](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/document.py#L36-L42)。

| 输入形态 | `parse()` 结果 |
|---|---|
| 空 frontmatter、YAML `null` | `{}` |
| YAML mapping | 接受，包括未知键和非字符串值 |
| 顶层 list 或非空 scalar | 拒绝：`Frontmatter must be a YAML mapping` |
| malformed YAML | 拒绝并包装 PyYAML 错误 |
| 未知或 Python-specific tag | `safe_load` 拒绝 |
| YAML anchor、alias、`<<` merge key | `safe_load` 接受并构造合并后的 mapping |
| duplicate mapping key | PyYAML 6.0.3 接受，后值覆盖前值 |
| YAML 1.1 implicit scalar，如 `yes` | 转成 Python `True`，不是字符串 `"yes"` |
| ISO-like timestamp plain scalar | 转成 Python `date` / `datetime` 对象 |

上游依赖只约束 `pyyaml>=6.0`，没有固定具体版本，因此以上 PyYAML 边界行为不是一个由仓库锁定的长期 parsing profile。证据：[`pyproject.toml` L5-L19](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/pyproject.toml#L5-L19)。

## `validate()` 的精确行为

源码只有一个判定：

```python
missing = [k for k in REQUIRED_FRONTMATTER_KEYS if not self.frontmatter.get(k)]
```

见 [`document.py` L56-L61](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/document.py#L56-L61)。因此：

- 四键都必须存在且值为 Python truthy；缺键与 falsey 值使用同一错误。
- `" "`、`1`、`True`、非空 list、非空 mapping 等都可通过。
- `""`、`0`、`False`、空 list、空 mapping、YAML `null` 都不能通过。
- 不做类型、字符串 trim、enum、datetime parse、时区、格式或语义校验。
- 不限制未知键，也不校验 body。
- YAML merge 继承出的四个键和直接声明的键同等有效。
- `validate()` 不 serialize、不规范化，也不返回诊断列表；第一轮一次性列出所有 missing/falsey keys 后抛异常。

上游测试仅证明缺 `description` / `timestamp` 会拒绝、四个字符串值会接受；没有字段类型和格式测试。证据：[`test_document.py` L46-L63](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/tests/test_document.py#L46-L63)。

## `serialize()` 与 round-trip

源码：[`document.py` L49-L54](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/document.py#L49-L54)。

它总是：

1. 用 `yaml.safe_dump(frontmatter, sort_keys=False, allow_unicode=True)` 输出 YAML；
2. 写标准的独占行 `---` delimiter；
3. 在结束 delimiter 和 body 间写一个空行；
4. 保证 body 以 `\n` 结尾。

即使 parse 的输入没有 frontmatter，调用 serialize 后也会生成一个内容为 `{}` 的 frontmatter block。serialize 不调用 validate；一个不满足四键要求的对象仍可被序列化。

### 保留什么

- 普通未知 key/value 会留在 Python mapping 中，并被重新输出。
- `sort_keys=False` 通常保持当前 Python dict insertion order。
- Unicode 直接输出，不强制转义。
- 对上游覆盖的普通案例，parse → serialize → parse 后 frontmatter 数据结构相等，body 在 trim 后相等。证据：[`test_document.py` L8-L30](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/tests/test_document.py#L8-L30)。

### 不保留什么

- YAML 注释、引号选择、flow/block style、缩进、空白与原始换行；
- duplicate keys 的前值；
- merge key/alias 的原始表达（常被展开）；
- implicit scalar 的原拼写，例如 `yes` 会输出 `true`；
- timestamp 的原 lexical form，例如 `2026-05-27T00:00:00+00:00` 经 PyYAML datetime 后可输出为 `2026-05-27 00:00:00+00:00`；
- body 的原换行风格、delimiter 后的部分空白与末尾换行数量。

因此这里的“preserve”只应表述为：对 PyYAML 可表示的数据，尽力保持解析后的 mapping 语义；不能表述为文本或 AST 级保真。

## 可复现实例

以下结果在固定源码加 PyYAML 6.0.3 上复现：

| case | 关键输入 | parse / validate / serialize 结果 |
|---|---|---|
| duplicate key | `type: first` 后接 `type: last` | parse 得 `type == "last"`；validate 可通过；serialize 只剩后值 |
| implicit types | `type: yes`, `title: 1`, `description: [x]`, plain timestamp | 分别成为 `True`、`1`、list、`datetime`；四者 truthy，validate 通过 |
| falsey types | `type: 0`, `title: false`, `description: ""`, `timestamp: []` | mapping 可 parse；validate 将四键全部报 missing |
| unknown tag | `type: !foo bar` | parse 拒绝，包装 PyYAML constructor error |
| YAML merge | 用 `<<: *base` 提供四键 | parse 展开 merge；validate 通过；serialize 不保留 merge 表达 |
| whitespace delimiters | 首尾 ` --- ` | parse 接受；serialize 改成标准 `---` |
| BOM | `\ufeff---` 开头 | 当作无 frontmatter，全文成为 body；parse 不报错，validate 失败 |
| literal delimiter | `note: |` 下一行是 `  ---` | 该缩进行被误作结束 delimiter，剩余 YAML 行成为 body |
| no frontmatter then serialize | 普通 Markdown | parse 为 `{}` + 原 body；serialize 添加 `---\n{}\n---` |

最小复现方式是从固定 commit 导入 `reference_agent.bundle.document`，安装该仓库允许的 PyYAML 6.0.3，然后依次调用 `OKFDocument.parse(text)`、`doc.validate()`、`doc.serialize()`。结果依赖 PyYAML；若复现其他 `>=6.0` 版本，应同时记录具体版本。

## 与 OKF v0.1 SPEC 的差异

### 比规范更严格

1. **四键 required。** reference validate 要求 `type`、`title`、`description`、`timestamp` 全部 truthy；规范只把 non-empty `type` 列为 REQUIRED，其他字段都 optional。规范证据：[SPEC §4.1 L122-L162](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L122-L162)、[§9 L341-L364](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L341-L364)。
2. **部分 YAML surface 被 PyYAML SafeLoader 排除。** 未知 tags 会拒绝；OKF 规范没有固定 YAML version/schema/tag profile，只要求 parseable YAML。这是 implementation-specific parsing choice，不是 OKF MUST。

### 比规范更宽松

1. **字段类型。** 规范把 `type` 描述为 short string，把 timestamp 描述为 ISO 8601 datetime；reference validate 接受任何 truthy Python 值。规范证据：[SPEC §4.1 L122-L159](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L122-L159)。
2. **delimiter 空白。** reference 接受前后带空白的 `---`，并会误认 block scalar 中缩进的 `---`；规范要求 delimiter 在独占行，reference 行为至少不是可依赖的严格 grammar。规范证据：[SPEC §4 L114-L121](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L114-L121)。
3. **parse 不等于 conformance。** 无 frontmatter 文档可被 parse 成空 mapping；只有调用方另行 validate 才会拒绝，而且拒绝依据仍是 reference 的四键规则。

### 未实现或语义不同

1. **没有 bundle conformance。** 不枚举 non-reserved `.md`，不区分 `index.md` / `log.md`，不检查 present reserved documents 的结构。OKF v0.1 的三项硬合规判据见 [SPEC §9 L341-L364](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L341-L364)。
2. **没有 consumer tolerance 判定。** unknown type/field 与 broken link 的宽容要求不在 `OKFDocument.validate()` 的职责中；它也不报告 links。
3. **未知字段仅获得偶然的普通 mapping round-trip。** 这满足简单案例的语义保存，但缺少 duplicate keys、YAML merges、comments、自定义 tags 等更完整 preservation contract。规范只要求 SHOULD 级语义保留，不要求文本保真；见 [SPEC §4.1 L160-L162](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L160-L162)。
4. **错误模型不是诊断 profile。** parse 与 validate 抛单一 `OKFDocumentError`；没有稳定 error code、path/line contract、warning/error 分级或多文档汇总。

## 对后续决策票的约束

- **YAML 解析与语义保存契约**不能简单采用 reference behavior；必须明确 delimiter grammar、BOM、YAML schema、duplicate keys、merge/alias/tag、字段类型和 round-trip 层级。
- **三层兼容性声明**应明确写成“可生成 reference agent 可读取/可写的普通 mapping 子集”，而不是“reference validator 证明 OKF conformant”。
- **Concept Write Contract**若追求 reference writer 兼容，应产出四个非空标量字段并使用标准 delimiter；但应另行验证 `type` 为非空字符串、timestamp 为约定的 ISO 8601 形式。
- **外部验收矩阵**至少分开测试 `parse`、`validate`、`serialize`、`parse→serialize→parse` 和 bundle conformance；不能用一个“validator pass”代替这些 seam。
- 应加入 reference regression cases：unknown fields、implicit YAML types、duplicate keys、BOM、whitespace delimiters、literal block 中的 `---`、merge keys，以及 no-frontmatter parse 后 serialize。

## 一手来源

- [`OKFDocument` 固定源码](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/document.py)
- [`OKFDocument` 固定测试](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/tests/test_document.py)
- [`write_concept_doc` 固定源码](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/tools/bundle_tools.py)
- [固定依赖声明](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/pyproject.toml)
- [固定 OKF v0.1 SPEC](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md)
