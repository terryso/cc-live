---
title: 'Epic 3: 工具结果智能渲染'
type: 'feature'
created: '2026-04-09'
status: 'done'
baseline_commit: 'cc69201'
context:
  - _bmad-output/planning-artifacts/epics.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 工具返回结果（tool_result）全部以 `esc()` 纯文本展示——代码无高亮、JSON 无缩进、markdown 无格式，用户难以理解工具返回了什么内容。

**Approach:** 创建 `renderToolResult(p)` 函数，自动检测 `p.text` 的内容类型（代码/JSON/文本），分别路由到 highlight.js 语法高亮、JSON 格式化缩进、或 `renderMd()` markdown 渲染。复用已有的 `renderMd()` + highlight.js + DOMPurify 管线。

## Boundaries & Constraints

**Always:**
- 所有渲染内容必须通过 DOMPurify 净化（FR18）或 `esc()` 转义
- 复用已有 `renderMd()`、highlight.js、`esc()`，不引入新依赖
- 内容类型检测基于文本特征（括号密度、缩进模式、代码围栏），不做精确解析
- 保留 `.tool-result` 容器的橙色边框视觉风格

**Ask First:**
- JSON 格式化是否需要语法高亮（key/value 颜色区分）

**Never:**
- 不修改 `lib.js` 中 tool_result 的构建逻辑
- 不修改 `tool_use` 渲染逻辑（Epic 2 已完成）
- 不引入外部 CSS/JS 依赖
- 不修改 `renderMd()` 或 marked 配置

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 代码围栏 | text 含 ```python...``` 围栏 | highlight.js 语法高亮代码块 | 未知语言等宽字体展示 |
| 裸代码 | text 高缩进率 + 语言特征关键字 | highlight.js 自动检测高亮 | 检测失败按文本处理 |
| JSON 对象 | text 以 `{` 开头，括号配对 >80% | 2 空格缩进格式化 JSON | 无效 JSON 降级为文本 |
| JSON 数组 | text 以 `[` 开头，括号配对 >80% | 2 空格缩进格式化 JSON | 无效 JSON 降级为文本 |
| 纯文本/markdown | 不符合代码/JSON 特征 | renderMd() markdown 渲染 | N/A |
| 空结果 | text 为空字符串或 null | 不渲染 tool-result div | N/A |
| 超长 JSON | text > 5000 字符的 JSON | 格式化展示 | 不截断（Epic 2 的截断不适用于结果） |
| 含 HTML | text 含 `<script>` 等 | DOMPurify 过滤危险标签 | 净化后安全渲染 |

</frozen-after-approval>

## Code Map

- `public/index.html:1184` -- 当前 tool_result 渲染行（需替换为 `renderToolResult(p)` 调用）
- `public/index.html:450-461` -- `.tool-result` CSS 样式（需扩展）
- `public/index.html:869-872` -- `renderMd()` 函数（复用）
- `public/index.html:862-866` -- marked + highlight.js code renderer（复用）
- `public/index.html:822` -- `esc()` HTML 转义函数（复用）

## Tasks & Acceptance

**Execution:**
- [x] `public/index.html:1202` -- 将 `tool_result` 分支从内联 HTML 改为调用 `renderToolResult(p)`
- [x] `public/index.html` JS 函数区 -- 添加 `renderToolResult(p)` + `detectContentType(text)` + 格式化逻辑（代码高亮、JSON 缩进、markdown 渲染）
- [x] `public/index.html` CSS 区 -- 添加工具结果类型专用样式（代码块高亮背景、JSON 缩进样式等）

**Acceptance Criteria:**
- Given 消息含 tool_result 块，when 渲染，then 根据内容类型自动选择渲染方式
- Given tool_result 含代码围栏（如 ```python），when 渲染，then 通过 highlight.js 语法高亮
- Given tool_result 以 { 或 [ 开头且为合法 JSON，when 渲染，then 2 空格缩进格式化展示
- Given tool_result 为普通文本，when 渲染，then 通过 renderMd() markdown 渲染
- Given tool_result 为空，when 渲染，then 不输出任何内容
- Given 所有渲染输出，when 检查 HTML，then 经过 DOMPurify 净化或 esc() 转义，无 XSS 注入点

## Verification

**Manual checks:**
- 打开直播页面，观察 AI 消息中工具返回结果的渲染效果
- 检查代码类结果是否有语法高亮
- 检查 JSON 结果是否有格式化缩进
- 检查纯文本结果是否有 markdown 格式（列表、粗体等）
- 检查空结果是否不显示

## Suggested Review Order

- 入口：tool_result 分支路由到 renderToolResult()，替代原 esc() 纯文本
  [`index.html:1242`](../../public/index.html#L1242)

- renderToolResult()：空值守卫 + detectContentType 路由到三种渲染器
  [`index.html:1012`](../../public/index.html#L1012)

- detectContentType()：代码围栏检测 → JSON 括号验证 → 缩进率启发式 → 文本兜底
  [`index.html:1022`](../../public/index.html#L1022)

- renderCodeResult()：围栏代码走 renderMd，裸代码走 hljs.highlightAuto
  [`index.html:1035`](../../public/index.html#L1035)

- renderJsonResult()：JSON.parse + 2 空格缩进 + esc() 转义
  [`index.html:1041`](../../public/index.html#L1041)

**CSS 样式**

- 工具结果类型样式（代码深色背景、JSON 浅色背景）
  [`index.html:462`](../../public/index.html#L462)
