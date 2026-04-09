---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain-skipped
  - step-06-innovation-skipped
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
inputDocuments:
  - _bmad-output/project-context.md
  - _bmad-output/brainstorming/brainstorming-session-2026-04-09-1900.md
workflowType: 'prd'
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 1
  projectDocs: 1
classification:
  projectType: web_app
  domain: developer_tool
  complexity: low
  projectContext: brownfield
---

# Product Requirements Document - cc-watch

**Author:** Nick
**Date:** 2026-04-09

## Executive Summary

cc-live 是一个实时查看 Claude Code 会话的 Web 应用，通过 SSE 将本地 JSONL 会话文件以消息流的形式推送到浏览器。本次改进聚焦于**消息渲染层**——将当前的"安全转义 + 纯文本"展示模式升级为接近 Claude Code 终端本身的体验。

当前核心问题：thinking 块使用 `esc()` 纯文本输出，丢失了 Claude 推理过程中的代码片段、列表、粗体等 markdown 格式；工具调用和工具结果中的 JSON 数据未格式化，一坨长文本难以阅读。这导致用户在看日志，而不是在看对话——直接削弱了 cc-live "实时看 Claude Code 会话"的核心价值。

### What Makes This Special

cc-live 的核心竞争力是"实时直播 Claude Code 会话"。消息渲染质量是这个核心价值的直接载体——用户看不清 AI 在想什么、做了什么，整个工具就退化为日志查看器。本次改进的目标是将消息展示从"可读"提升到"接近 Claude Code 终端体验"，让 thinking 有结构化展示、工具调用有专用格式、代码有语法高亮。参考项目 claude-history 已验证了这些渲染方式的可行性。

## Project Classification

| 维度 | 分类 |
|------|------|
| 项目类型 | Web App（SSE 实时消息流） |
| 领域 | 开发者工具 |
| 复杂度 | 低（无合规/监管约束） |
| 项目上下文 | 棕地（现有系统改进） |

## Success Criteria

### User Success

用户打开 cc-live 观看会话时，消息展示效果接近 Claude Code 终端体验：
- Thinking 块保留 markdown 格式（代码片段、列表、粗体），推理过程清晰可读
- 工具调用每种类型都有专用格式，一眼看出 AI 做了什么操作
- JSON 数据格式化、缩进、有结构的展示，不再是原始文本
- 工具结果根据内容类型智能渲染（代码走语法高亮，JSON 走格式化）

### Business Success

cc-live 的核心价值"实时看 Claude Code 会话"不再因渲染质量打折——用户看到的是结构化对话流，不是原始日志。

### Technical Success

- SSE 实时性不受影响，XSS 安全不退步，零外部依赖约束不变
- 前端文件大小不显著膨胀——工具格式化逻辑保持精简

### Measurable Outcomes

- Thinking 块：从 `esc()` 纯文本 → `renderMd()` markdown 渲染
- 工具调用：每种工具类型都有专用格式化器
- 工具结果：内容类型自动检测，代码走高亮、JSON 走格式化

## User Journeys

### Journey 1: 直播者自检 — "我确认 AI 在做正确的事"

Nick 正在用 Claude Code 开发一个复杂功能，cc-live 在另一个屏幕上实时显示会话流。Claude 开始了一段长长的 thinking——Nick 扫了一眼 cc-live，想快速确认 AI 的推理方向对不对。

**当前痛点：** thinking 是一坨灰色斜体纯文本，代码片段、步骤列表全挤在一起，分不清哪里是推理、哪里是代码。Nick 不得不切回终端去看。

**改进后：** thinking 块走 markdown 渲染——推理步骤有编号、代码有语法高亮、关键决策有粗体标记。一眼确认 AI 思路，不用切屏。AI 调用 Edit 工具修改文件时，显示文件路径 + diff 效果，而不是一坨 JSON。

**能力需求：** Thinking markdown 渲染、工具专用格式（Edit diff）、实时性不受影响

### Journey 2: 观众学习 — "看懂别人怎么跟 AI 协作"

一个初级开发者打开了 cc-live 的直播链接，想学习资深开发者怎么使用 Claude Code。他看到消息流不断滚动，但工具调用全是原始 JSON——他分不清哪个是读文件、哪个是执行命令。AI 的 thinking 完全看不懂，一大段灰色文字没有结构。他放弃了，觉得还不如直接看代码。

**改进后：** 每个工具调用都有清晰的专用格式——Bash 像终端命令、Read 显示文件路径和行号、Grep 显示搜索词。跟着消息流就能理解整个开发过程的逻辑。当 AI 用 Agent 工具派了一个子代理去做代码审查时，cc-live 显示子代理的描述和目标。他第一次真正理解了多代理协作是怎么工作的。

**能力需求：** 工具专用格式（全部类型）、Agent 子代理格式化、工具结果智能渲染

### Journey 3: 回看者复盘 — "找到那个关键决策点"

一个团队成员通过分享链接打开昨天的开发会话，想找到 AI 建议使用某种架构方案的那个时间点。当前所有工具调用长得一样——都是 JSON，他不得不逐条展开消息寻找关键变更。

**改进后：** 工具调用格式清晰——Bash 命令一目了然、Read/Edit 显示具体文件路径。他能快速扫描消息流，找到"AI 修改了架构文件"的那个节点。Thinking 块的 markdown 格式让他看清 AI 当时的推理逻辑。

**能力需求：** 工具专用格式提供视觉扫描效率、Thinking 渲染保留推理结构、消息内容可快速浏览

### Journey Requirements Summary

| 旅程 | 核心需求 | 关联能力 |
|------|---------|---------|
| 直播者自检 | 实时确认 AI 推理和操作 | Thinking 渲染 + Edit diff 格式 |
| 观众学习 | 理解开发过程和多代理协作 | 全部工具专用格式 + Agent 格式化 |
| 回看者复盘 | 快速扫描定位关键决策 | 工具格式视觉区分 + Thinking 推理结构 |

## Technical Requirements

### Architecture Constraints

- 单 HTML 文件 SPA，无框架、无构建工具，零外部依赖
- SSE 实时通信，前端已有 `marked` + `highlight.js` + `DOMPurify`
- 改动集中在 `public/index.html` 的 `msgContent()` 函数及其周边逻辑

### Browser Support

- 现代浏览器最新版（Chrome、Edge、Firefox、Safari）
- 无障碍（Accessibility）不在本次改进范围内

## Product Scope

### MVP (Phase 1)

1. **Thinking 块 markdown 渲染** — `esc(p.text)` → `renderMd(p.text, true)`
2. **JSON 格式化** — 工具参数和结果中的 JSON 自动缩进、高亮
3. **工具专用格式** — 每种工具类型的定制化显示：
   - Bash：只显示命令文本，终端风格
   - Read：文件路径 + 行范围
   - Edit：文件路径 + diff 效果
   - Write：文件路径 + 内容预览
   - Grep/Glob：搜索词 + 范围
   - Agent：子代理描述 + 摘要
   - TodoWrite：任务列表格式化
   - WebSearch：搜索关键词
   - 其他未知工具：通用 JSON 格式化兜底
4. **工具结果智能渲染** — 检测内容类型，代码走高亮，JSON 走格式化

### Phase 2 (Growth)

- 消息体折叠/展开交互优化
- Diff 渲染增强（更精细的颜色区分）
- 子代理嵌套对话的层级展示

### Phase 3 (Vision)

- 消息渲染完全匹配 Claude Code 终端视觉效果
- 代码编辑操作的实时 diff 动画

### Risk Mitigation

| 风险 | 缓解策略 |
|------|---------|
| 工具参数格式变化 | 兜底机制——未知格式回退通用 JSON 格式化 |
| 大段 thinking 渲染性能 | 已有管线验证无性能问题，极端情况可截断 |
| 8 种工具格式过度设计 | 每种只做核心信息提取，不做过度美化 |

## Functional Requirements

### Thinking 内容渲染

- FR1: 系统能将 AI thinking 块以 markdown 格式渲染（支持代码块、列表、粗体、链接等）
- FR2: 系统能在 thinking 渲染中保留语法高亮（代码片段）
- FR3: 系统能对超过 500 字符的 thinking 内容截断显示，提供展开按钮查看完整内容

### 工具调用格式化

- FR4: 系统能识别不同工具类型，为每种工具提供专用显示格式

**工具格式视觉示例：**
- **Bash:** `$ git status` — 终端样式，命令行前缀
- **Read:** `📄 src/lib.js (L10-L50)` — 文件图标 + 路径 + 行范围
- **Edit:** `✏️ src/lib.js` + 红/绿色 diff 块（旧内容 → 新内容）
- **Write:** `📝 src/new-file.js` + 前 10 行代码预览
- **Grep:** `🔍 "pattern" in src/` — 搜索图标 + 关键词 + 目录
- **Agent:** `🤖 Explore (search codebase)` — 子代理类型 + 描述
- **TodoWrite:** 待办列表渲染（勾选框 + 任务文本）
- **WebSearch:** `🌐 "search query"` — 搜索图标 + 关键词
- **未知工具:** 缩进 JSON 展示（兜底）

- FR5: 系统能将 Bash 工具的 command 参数以终端命令风格展示
- FR6: 系统能将 Read 工具的 file_path 和行范围信息格式化展示
- FR7: 系统能将 Edit 工具的 file_path、old_string、new_string 以 diff 风格展示
- FR8: 系统能将 Write 工具的 file_path 和前 10 行内容预览格式化展示
- FR9: 系统能将 Grep/Glob 工具的搜索模式和路径范围格式化展示
- FR10: 系统能将 Agent 工具的子代理类型、描述和摘要格式化展示
- FR11: 系统能将 TodoWrite 工具的任务列表以结构化格式展示
- FR12: 系统能将 WebSearch 工具的搜索关键词格式化展示
- FR13: 系统能对未知工具类型回退到通用 JSON 格式化展示

### 工具结果智能渲染

- FR14: 系统能根据内容特征（括号密度、缩进模式、语言标识符）自动检测工具返回结果的内容类型
- FR15: 系统能将代码类型的工具结果以语法高亮展示
- FR16: 系统能将 JSON 类型的工具结果以格式化缩进展示
- FR17: 系统能将纯文本类型的工具结果以 markdown 渲染展示

### 渲染安全

- FR18: 系统能确保所有动态内容经过 HTML 转义或净化处理后再渲染
- FR19: 系统能确保工具专用格式化器输出的 HTML 不含未转义的用户内容

## Non-Functional Requirements

### Performance

- NFR1: 单条消息渲染时间不超过 50ms（含 markdown 解析 + DOMPurify 清洗 + DOM 插入）
- NFR2: SSE 消息流推送间隔不受渲染逻辑影响——新消息到达后立即显示
- NFR3: 超长内容（>5000 字符的 thinking 或工具结果）渲染不阻塞主线程
- NFR4: 页面滚动流畅度不受消息渲染影响——60fps 无掉帧

### Security

- NFR5: 所有经过 markdown 渲染的内容必须通过 HTML 净化处理
- NFR6: 工具专用格式化器的所有动态输出必须经过 HTML 实体转义
- NFR7: 不允许在渲染管线中引入新的未净化 HTML 注入点
