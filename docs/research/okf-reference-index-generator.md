# OKF reference index generator 的发现、生成与幂等行为

> 调研对象：GoogleCloudPlatform/knowledge-catalog reference agent 的 `regenerate_indexes()`  
> 固定实现基线：commit [`d44368c15e38e7c92481c5992e4f9b5b421a801d`](https://github.com/GoogleCloudPlatform/knowledge-catalog/commit/d44368c15e38e7c92481c5992e4f9b5b421a801d)（2026-06-21）  
> 规范对照基线：commit [`ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a`](https://github.com/GoogleCloudPlatform/knowledge-catalog/commit/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a) 的 OKF v0.1 SPEC  
> 复现实验：Python 3.11+、PyYAML 6.0.3、固定 deterministic synthesis stub 及 changing stub  
> 调研日期：2026-07-22

## 结论摘要

reference index generator 是一个**自底向上、覆盖写、宽容读取**的逐目录 materializer，不是 bundle scanner、validator 或稳定的增量构建器：

- 它先用 `bundle_root.rglob("*.md")` 找到至少含一个小写 `.md` 后缀文件的目录及其全部祖先，再按深度从深到浅处理。
- 处理一个目录时，它只跳过精确小写的 `index.md`；`log.md`、无 frontmatter 文档和缺少 `type` / `description` 的 Markdown 都可能进入索引。解析抛异常的文档则被静默跳过。
- 它会把当前目录下**所有子目录**写成 `child/index.md` 链接，包括空目录和没有 Markdown 的目录，即使那些目录本身不会生成 index。
- 它按 type 分 section、section 名区分大小写排序；条目按 title 的 lowercase 值排序；链接是文件名或 `child/index.md` 的直接相对链接。
- 每次运行都覆盖有 entries 的 `index.md`。根 index 中已有的 `okf_version` frontmatter、人工内容和未知内容全部丢失；没有 entries 时既不写也不删除，因此 stale index 会永久保留。
- 使用 deterministic synthesizer 且文件树不变时，生成**内容**可达固定点；但仍每次写盘。默认路径会重新调用生成模型合成多子项目录描述，因此不保证 byte/content 幂等。
- 它生成的普通案例符合 OKF v0.1 §6 的大体结构，但不能保证任意输入 bundle 或既有 reserved documents 合规；它也不能维护可选的根版本声明。

后续应把该行为描述为一个单独的 **Reference Index Generator Compatibility Profile**，而不是 canonical bundle 的生命周期契约。

## 调用时机与职责边界

reference runner 在完成数据源与 web pass 后调用 `regenerate_indexes(bundle_root, model=self.model)`。证据：[`runner.py` L276-L280](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/runner.py#L276-L280)。

生成器只返回本次写过的 `index.md` 路径列表。它没有 manifest、缓存、dirty check、删除清单、诊断清单或事务边界；源码入口见 [`index.py` L49-L58](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/index.py#L49-L58)。不存在的 bundle root 直接返回空列表。

## 目录发现

源码：[`index.py` L37-L46](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/index.py#L37-L46)。

算法为：

1. 对 `bundle_root.rglob("*.md")` 的每个结果取 parent；
2. 把该 parent 到 bundle root 的每一级祖先加入 set；
3. 去重后返回排序结果；
4. `regenerate_indexes()` 再按 `(-relative_depth, str(path))` 排序，从最深目录向 root 处理。

证据：[`index.py` L60-L63](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/index.py#L60-L63)。自底向上是为了先得到子目录描述，再将其写入父 index。

由此产生以下边界：

- 空树或只有空目录的树没有任何待处理目录，不生成 root index。
- 任意 `.md` 都可触发目录发现，包括已有 `index.md`、`log.md`、无效 Concept 和 stale generated index。
- 非 Markdown 文件本身不触发发现。
- 已生成的 `index.md` 会在后续运行继续让其目录保持“被发现”，即使真正 Concepts 已全部删除。
- “发现哪些目录”和“父 index 列出哪些子目录”不是同一个条件：只要父目录因任何 `.md` 被处理，它就会枚举 `iterdir()` 看到的全部 child directories。因此一个空 sibling 可能被父 index 列出，但不会生成自己的 index。

上游“skip empty directories”测试只覆盖**整个 bundle 没有任何 Markdown**的情况，并未覆盖“有内容的父目录旁存在空 sibling”。证据：[`test_index.py` L64-L71](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/tests/test_index.py#L64-L71)。

## Markdown 文件发现与容错

每个待处理目录按 `sorted(directory.iterdir())` 遍历 immediate children。证据：[`index.py` L67-L73](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/index.py#L67-L73)。

### `index.md`

仅 `child.name == "index.md"` 被无条件跳过：不 parse、不作为条目，也不保留其内容。只要目录有其他 entries，随后直接覆盖这个路径。证据：[`index.py` L70-L72](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/index.py#L70-L72)、[`index.py` L86-L91](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/index.py#L86-L91)。

影响：

- root `index.md` 中合法的 `okf_version: "0.1"` 会被删除；生成器没有版本参数或 merge 逻辑。
- 人工 sections、注释和任何扩展内容都会丢失。
- 若目录除 `index.md` 外没有 entries，则运行会 `continue`，既不重写也不删除该 index；它可能保持 stale 或不合规。

### `log.md`

生成器没有 reserved-document 排除集合，因此 `log.md` 走普通 `.md` 分支：能被 `OKFDocument.parse()` 读取就会成为索引条目。一个正常无 frontmatter 的 log 会得到 title `log`、空 type、空 description，最终出现在 `# Other` 下。它不会校验 log 的日期结构。

### 无 frontmatter、缺字段与解析失败

`_load_doc()` 捕获所有异常并返回 `None`。证据：[`index.py` L14-L18](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/index.py#L14-L18)。结合 `OKFDocument.parse()` 的行为：

- 无 frontmatter 文档 parse 成空 mapping，因此**会被索引**；
- 缺 `type`、`title`、`description` 或 `timestamp` 不触发 validate，因此仍可被索引；
- malformed YAML、unterminated frontmatter、非 mapping YAML、UTF-8 decode error 等异常被**静默跳过**；
- 没有 warning、error、skipped count 或 path 诊断。

字段 fallback 见 [`index.py` L73-L81](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/index.py#L73-L81)：

- title：`str(frontmatter.title or file.stem)`；
- description：`str(frontmatter.description or "")`；
- type：`str(frontmatter.type or "")`。

因此 falsey title 回退到 stem，falsey type 进入 `Other`，falsey description 不输出 suffix；任意 truthy list/mapping/number 会用 Python `str()` 表示，而不是被类型校验。

## 子目录行为

每个 immediate child directory 都成为：

```text
("Subdirectories", child.name, "child.name/index.md", propagated_description)
```

证据：[`index.py` L82-L84](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/index.py#L82-L84)。

这意味着：

- 链接固定指向 `subdir/index.md`，不是 SPEC 示例中的 `subdir/`；两者都是相对 Markdown URL，但可观察行为不同。
- 空目录、只有非 Markdown 文件的目录也会被已处理的父目录列出；它们自身没有 index，于是生成 broken link。
- 如果 child 不在本轮 `directories` 中，`dir_descriptions` 没有值，父条目无描述。
- stale child index 会让 child 与祖先持续被发现，并可形成长期 phantom navigation tree。

OKF v0.1 要求 consumers 容忍 broken links，所以空目录链接本身不会让 bundle 不合规；但它说明 generator 并不保证“每个生成的 subdirectory link 都有 materialized target”。规范证据：[SPEC §5.3 L257-L267](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L257-L267)。

## 输出格式与排序

`_build_index_text()` 的源码见 [`index.py` L21-L34](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/index.py#L21-L34)。

输出规则：

1. 空 type 归到 `Other`；子目录归到 `Subdirectories`。
2. section 按 type 字符串的 Python 默认、区分大小写顺序排序。
3. 每个 section 使用 H1：`# <type>`。
4. 条目按 `title.lower()` 排序；相同 lowercase key 保持此前 child path 排序的稳定顺序。
5. 条目格式是 `* [title](relative_link)`；有 description 时追加 ` - description`。
6. sections 间一个空行，文件末尾一个 newline。
7. 不生成 frontmatter。

实现不会 Markdown-escape section、title、link 或 description。metadata 或文件名中的 `]`、`)`、换行、Markdown 控制字符等可能改变输出结构；因此格式只对普通字符串子集可靠。

上游正常案例测试确认 type grouping、title、直接文件相对链接、description 和 `Subdirectories` section；见 [`test_index.py` L27-L61](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/tests/test_index.py#L27-L61)。测试未覆盖排序冲突、escaping、`log.md`、无 frontmatter、malformed docs、existing index 或重复运行。

## 目录描述合成

每个非 root 目录在 index 写盘后生成供父目录使用的 description：

- 若 entries 恰好一个且它有 description，直接复用；
- 否则调用 `synthesize(relative_path, [(title, description), ...], model=model)`。

证据：[`index.py` L93-L101](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/index.py#L93-L101)。单 child 复用行为有测试：[`test_index.py` L74-L94](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/tests/test_index.py#L74-L94)。

默认 synthesizer 每次创建 GenAI client 并调用模型，只取响应首行；空响应或异常时退回 `Contains N entries: titles.`。证据：[`synthesizer.py` L21-L50](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/synthesizer.py#L21-L50)。

它没有 cache、seed、输出 hash 或确定性约束。prompt 虽要求一句话，但代码只截取首行，不检查长度、结尾标点或 Markdown escaping。

## 重复生成与幂等性

### 可成立的有限结论

当以下条件同时满足时，重复生成的**文件内容**相同：

- 文件树及解析后的 metadata 不变；
- synthesizer 对相同输入返回相同字符串；
- Python/PyYAML/文件系统排序语义不变；
- 没有并发修改。

原因是 entries 与排序均确定，生成的 index 在下一轮会参与目录发现但在 entries 阶段被跳过，不会产生自引用。

### 不能声称完整幂等

- 即使 bytes 不变，`write_text()` 每轮仍覆盖写，mtime 与文件系统事件会变化；不是 no-op idempotence。
- 默认模型合成每轮重新执行，可能给出不同 description；不保证 byte/content idempotence。
- 模型成功与 fallback 之间切换也会改变父 index。
- 删除最后一个真实 Concept 后，既有 index 自己仍触发目录发现；因为没有 entries，旧 index 不删除，stale 内容保留。
- root index 合法版本 frontmatter在第一次有 entries 的生成中丢失，所以“保留 bundle 版本声明”不是固定点 invariant。
- 生成过程逐目录立即写盘，无临时文件或原子 publish；中途异常可留下部分新、部分旧的 index tree。

因此准确表述是：**在 deterministic synthesis 和稳定输入下，生成文本函数具有内容固定点；整个 materialization 操作不保证无写入、删除收敛、模型确定性、原子性或崩溃一致性。**

## 可复现实例

固定源码与 PyYAML 6.0.3 下构造：root 包含无 frontmatter 的 `a.md`、unterminated YAML 的 `bad.md`、无 frontmatter 的 `log.md`、只有 title 的 `other.md`、已有带 `okf_version` 的 root `index.md`、`sub/one.md` 以及空目录 `empty/`。使用 deterministic `lambda: "stub"` 后：

```markdown
# Other

* [a](a.md)
* [log](log.md)
* [Named](other.md)

# Subdirectories

* [empty](empty/index.md)
* [sub](sub/index.md) - Only desc
```

可观察结果：

- `bad.md` 静默缺席；
- `a.md`、`log.md` 和不合规的 `other.md` 被列出；
- `empty/index.md` 不存在但被链接；
- root 的 `okf_version` frontmatter 与旧正文被覆盖；
- `sub/index.md` 正常生成，并复用唯一 child 的 description；
- 第二次使用相同 deterministic stub 得到相同 bytes，但仍重写文件；
- 删除 `sub/one.md` 后再次生成，旧 `sub/index.md` 仍保留并继续列出已删除的 `one.md`；
- 改用每次返回 `call-1`、`call-2` 的 synthesizer，父 index 两轮 bytes 不同，直接证明接口层不保证内容幂等。

## 与 OKF v0.1 SPEC 的关系

SPEC §6 允许任意目录出现无 frontmatter 的 `index.md`，使用一个或多个 heading sections 和 Markdown list links；条目 SHOULD 包含 linked Concept 的 description，producer MAY 自动生成。证据：[SPEC §6 L271-L295](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L271-L295)。

### 普通输入下相符之处

- 生成文件无 frontmatter；
- 使用 H1 sections 与 Markdown list links；
- 直接文件链接为相对路径；
- 有 description 时写入 description；
- 可逐目录生成 progressive-disclosure index。

### 不能由 generator 保证之处

1. **任意输入 bundle 的 conformance。** 无 frontmatter Concept 会被列出，malformed Concept 会被跳过，但两者都留在 tree 中；generator 不修复、不拒绝也不诊断。bundle 仍违反 §9。
2. **reserved-document conformance。** `log.md` 不校验；无 entries 的 malformed/stale `index.md` 不重写或删除。
3. **根版本声明保持。** 根 `okf_version` 合法且可选，但任何正常覆盖都会删除它。规范证据：[SPEC §11 L382-L396](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L382-L396)。删除后 bundle 仍可能 v0.1 conformant，因为声明是 MAY，但版本检测能力丢失。
4. **所有输出始终满足 index structure。** 未转义 metadata/路径可以破坏 Markdown；额外列出 `log.md` 及链接不存在的 empty child 是 reference-specific 行为，SPEC 没有要求这种枚举策略。
5. **描述完整性。** 缺 description 时不合成 Concept description，只省略 suffix；这不违反 SHOULD 的硬合规，但不能声称每项都有描述。

OKF v0.1 的 bundle 硬合规仍需独立 validator 判断：[SPEC §9 L341-L364](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md#L341-L364)。

## 对后续决策票的约束

- **Reserved documents 规范策略**必须决定 root version frontmatter 是生成器 authority 的一部分，不能照搬 reference 的全覆盖行为。
- **Reserved documents 生命周期与幂等规则**必须分别定义发现、创建、更新、删除、stale cleanup、empty directory、mixed empty sibling 和 deterministic descriptions。
- **Bundle Mutation Contract**需要决定 index tree 是同一原子提交、可恢复派生物，还是允许暂时陈旧；reference 的逐文件覆盖不能充当目标一致性模型。
- **Reference Tool Compatibility Profile**应记录可观察输出：type grouping、case-sensitive section order、case-folded title order、`child/index.md` links、single-child description reuse，以及 `log.md` / no-frontmatter inclusion。
- **外部验收矩阵**至少覆盖 existing root version frontmatter、only-index/stale-index、only-log、malformed/no-frontmatter docs、empty-only tree、mixed empty sibling、escaping、重复生成与 changing synthesizer。
- 若本项目要求严格幂等，目录 description 必须来自 deterministic function、稳定缓存或显式保存的 authority，不能在每次 rebuild 时无条件调用生成模型。

## 一手来源

- [`index.py` 固定源码](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/index.py)
- [`synthesizer.py` 固定源码](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/bundle/synthesizer.py)
- [`test_index.py` 固定测试](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/tests/test_index.py)
- [`runner.py` 固定调用点](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/d44368c15e38e7c92481c5992e4f9b5b421a801d/okf/src/reference_agent/runner.py#L276-L280)
- [固定 OKF v0.1 SPEC](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/SPEC.md)
