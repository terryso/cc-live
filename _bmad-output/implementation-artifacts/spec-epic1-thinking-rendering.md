---
title: 'Epic 1: Thinking 推理可读化'
type: 'feature'
created: '2026-04-09'
status: 'done'
baseline_commit: '64cb90b'
context:
  - _bmad-output/planning-artifacts/epics.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Thinking 块目前用 `esc()` 纯文本输出，AI 的推理过程（代码、列表、决策）显示为一坨灰色斜体文本，难以阅读。

**Approach:** 将 thinking 渲染从 `esc()` 升级为 `renderMd()`，复用已有的 marked + highlight.js + DOMPurify 管线。对超长内容增加截断/展开交互，避免单个 thinking 块撑爆消息流。

## Boundaries & Constraints

**Always:**
- 所有渲染内容必须通过 DOMPurify 净化（FR18）
- 复用已有 `renderMd()` 和 marked 配置，不引入新依赖
- 保留现有 thinking 视觉样式（灰色背景、气泡图标前缀、斜体标识）
- 截断/展开不重新触发 markdown 解析

**Ask First:**
- 截断阈值是否需要从 500 字符调整
- 截断按钮样式（行内链接 vs 独立按钮）

**Never:**
- 不修改 `renderMd()` 函数签名或 marked 全局配置
- 不改动 tool_use / tool_result 的渲染逻辑（Epic 2/3 范围）
- 不引入外部 CSS/JS 依赖

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 短 thinking | ≤500 字符，含列表/粗体/代码块 | 完整 markdown 渲染，无截断按钮 | N/A |
| 长 thinking | >500 字符 | 渲染前 500 字符 + "展开"按钮 | N/A |
| 展开后 | 点击"展开" | 显示完整渲染内容，按钮变为"收起" | N/A |
| 收起后 | 点击"收起" | 恢复截断状态，按钮变为"展开" | N/A |
| 含代码块 | thinking 含围栏代码 | highlight.js 语法高亮 | 未知语言以等宽字体展示 |
| 空 thinking | 空字符串或 null | 不渲染 thinking div | N/A |
| 含 HTML 标签 | thinking 含 `<script>` 等 | DOMPurify 过滤危险标签 | 净化后安全渲染 |

</frozen-after-approval>

## Code Map

- `public/index.html:982` -- thinking 渲染行（当前 `esc(p.text)`，需改为 `renderMd` + 截断）
- `public/index.html:787-791` -- `renderMd()` 函数（复用）
- `public/index.html:780-784` -- marked 配置含 highlight.js code renderer（复用）
- `public/index.html:785-786` -- DOMPurify 允许标签/属性列表（复用）
- `public/index.html:740` -- `esc()` HTML 转义工具函数（复用）
- `public/index.html:342-348` -- `.msg-thinking` CSS 样式（需扩展）
- `public/index.html:972-990` -- `msgContent()` 函数（修改 thinking 分支）

## Tasks & Acceptance

**Execution:**
- [x] `public/index.html` CSS 区域 -- 添加 `.thinking-toggle` 按钮样式和 `.thinking-full` / `.thinking-collapsed` 状态类，确保样式与现有设计语言一致（灰色系、圆角、小字号）
- [x] `public/index.html:1022` -- 将 thinking 渲染从 `esc(p.text)` 改为调用 `renderThinking(p.text)`，包含截断逻辑 + `renderMd(p.text, true)`
- [x] `public/index.html:813-831` -- 添加 `renderThinking()` 函数和 `toggleThinking(el)` 事件处理函数

**Acceptance Criteria:**
- Given 消息含 thinking 块，when 渲染，then 内容通过 renderMd 渲染（支持代码块、列表、粗体、链接），且经过 DOMPurify 净化
- Given thinking 含围栏代码块，when 渲染，then 代码通过 highlight.js 语法高亮
- Given thinking 长度 >500 字符，when 渲染，then 默认显示前 500 字符 + 展开按钮
- Given 点击展开按钮，when 展开，then 显示完整内容且按钮变为收起
- Given thinking 长度 ≤500 字符，when 渲染，then 完整显示无截断按钮
- Given 截断/展开操作，when 切换，then 不重新触发 markdown 解析（使用预渲染的 HTML）

## Verification

**Manual checks:**
- 打开直播页面，观察 AI assistant 消息中的 thinking 块是否有 markdown 格式（粗体、列表、代码高亮）
- 检查超长 thinking 块是否默认折叠，点击展开/收起正常工作
- 检查含 `<script>` 等危险标签的 thinking 内容是否被 DOMPurify 过滤
- 检查短 thinking 块是否无截断按钮、正常显示

## Suggested Review Order

**Thinking 渲染核心逻辑**

- 入口：thinking 分支路由到新函数，替代 esc() 纯文本输出
  [`index.html:1022`](../../public/index.html#L1022)

- renderThinking()：截断判定 + renderMd 渲染 + 展开收起 HTML 生成
  [`index.html:813`](../../public/index.html#L813)

- toggleThinking()：CSS 类切换 + 联动展开消息体
  [`index.html:831`](../../public/index.html#L831)

**CSS 样式**

- 截断状态 + 切换按钮 + markdown 元素样式覆盖
  [`index.html:349`](../../public/index.html#L349)
