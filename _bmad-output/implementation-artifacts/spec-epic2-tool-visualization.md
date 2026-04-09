---
title: 'Epic 2: 工具操作可视化'
type: 'feature'
created: '2026-04-09'
status: 'done'
baseline_commit: '41ab8c2'
context:
  - _bmad-output/planning-artifacts/epics.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 所有工具调用（Bash、Read、Edit、Write 等）都显示为相同的 JSON 格式——工具名 + 原始参数字符串，用户无法一眼区分不同操作类型。

**Approach:** 创建 `renderToolUse(p)` 路由函数，根据 `p.toolName` 分发到专用格式化器。每种工具有独特的图标、颜色和布局（Bash 终端风格、Edit diff 风格、Read 文件路径等），未识别工具回退到格式化 JSON 展示。

## Boundaries & Constraints

**Always:**
- 所有格式化器的动态输出必须通过 `esc()` 转义（FR19）
- `p.args` 是 JSON 字符串，需 `JSON.parse` 获取参数对象
- 复用现有 `esc()` 函数，不引入新依赖
- 保留 `.tool-call` 容器结构，扩展内部内容

**Ask First:**
- 工具图标使用 emoji 还是 CSS 图标
- Edit diff 是否需要行号

**Never:**
- 不修改 `lib.js` 中 display.parts 的构建逻辑
- 不修改 `tool_result` 渲染（Epic 3 范围）
- 不引入外部 CSS/JS 依赖
- 不修改 `renderMd()` 或 marked 配置

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bash 工具 | toolName="Bash", args 含 command | 终端风格：`$ command` 深色背景 | command 缺失时显示工具名 |
| Read 工具 | toolName="Read", args 含 file_path | `📄 path` + 可选行范围 L10-L50 | file_path 缺失时回退 JSON |
| Write 工具 | toolName="Write", args 含 file_path, content | `📝 path` + 前 10 行代码预览 | content 缺失时只显示路径 |
| Edit 工具 | toolName="Edit", args 含 file_path, old_string, new_string | `✏️ path` + 红/绿 diff 块 | 缺失字段时显示已有字段 |
| Grep 工具 | toolName="Grep", args 含 pattern, path | `🔍 "pattern" in path/` | path 缺失省略目录部分 |
| Glob 工具 | toolName="Glob", args 含 pattern | `🔍 "pattern"` | 同 Grep |
| Agent 工具 | toolName="Agent", args 含 description 或 prompt | `🤖 type (description)` | description 缺失截取 prompt 前 50 字符 |
| TodoWrite | toolName="TodoWrite", args 含 todos 数组 | 勾选框列表 ☑/☐ | todos 非数组回退 JSON |
| WebSearch | toolName="WebSearch", args 含 query | `🌐 "query"` | query 缺失回退 JSON |
| 未知工具 | 任意其他 toolName | 格式化 JSON（缩进 + 高亮） | N/A |
| args 解析失败 | args 非合法 JSON | 回退到 `esc(p.args)` 原始展示 | 不抛异常 |

</frozen-after-approval>

## Code Map

- `public/index.html:1026` -- 当前 tool_use 渲染行（需替换为 `renderToolUse(p)` 调用）
- `public/index.html:1015-1033` -- `msgContent()` 函数（修改 tool_use 分支）
- `public/index.html:740` -- `esc()` HTML 转义函数（复用）
- `public/index.html:370-386` -- `.tool-call` / `.tname` / `.targs` CSS 样式（需扩展）
- `public/index.html:787-791` -- `renderMd()` 函数（Write 预览复用）

## Tasks & Acceptance

**Execution:**
- [x] `public/index.html:1181` -- 将 `tool_use` 分支从内联 HTML 改为调用 `renderToolUse(p)`
- [x] `public/index.html` JS 函数区 -- 添加 `renderToolUse(p)` 路由函数 + 9 个专用格式化器（`fmtBash`, `fmtRead`, `fmtWrite`, `fmtEdit`, `fmtGrep`, `fmtAgent`, `fmtTodo`, `fmtWebSearch`, `fmtFallback`）
- [x] `public/index.html` CSS 区 -- 为每种工具类型添加专用样式（终端风格、diff 红绿、文件路径、搜索框、任务列表等）

**Acceptance Criteria:**
- Given 消息含 tool_use 块，when 渲染，then 根据 toolName 路由到对应格式化器，每种工具有独特视觉展示
- Given Bash 工具，when 渲染，then 显示终端风格（`$` 前缀 + 深色背景 + 等宽字体）
- Given Edit 工具，when 渲染，then 显示 diff 风格（红色删除 + 绿色添加）
- Given 未知工具名，when 渲染，then 回退到格式化 JSON 展示
- Given args 不是合法 JSON，when 解析，then 回退到 esc() 原始展示，不抛异常
- Given 所有格式化器输出，when 检查 HTML，then 动态内容经过 esc() 转义，无 XSS 注入点

## Verification

**Manual checks:**
- 打开直播页面，观察 AI 消息中的各种工具调用是否有专用格式（Bash 终端风格、Read 文件路径、Edit diff 等）
- 检查未知工具是否显示格式化 JSON
- 检查 args 解析失败时是否优雅降级
- 浏览器开发者工具检查无 XSS 注入（所有动态内容经过转义）

## Suggested Review Order

- 入口：tool_use 分支路由到 renderToolUse()，替代原内联 HTML
  [`index.html:1183`](../../public/index.html#L1183)

- renderToolUse()：JSON 解析 + 类型守卫 + 工具名分发到专用格式化器
  [`index.html:898`](../../public/index.html#L898)

- fmtBash / fmtRead / fmtWrite：终端命令、文件路径、文件预览格式化
  [`index.html:914`](../../public/index.html#L914)

- fmtEdit：diff 风格红绿展示，old/new 字段独立渲染
  [`index.html:939`](../../public/index.html#L939)

- fmtSearch / fmtAgent / fmtTodo / fmtWebSearch：搜索、子代理、任务列表、网络搜索格式化
  [`index.html:949`](../../public/index.html#L949)

- fmtFallback：未知工具的格式化 JSON 兜底展示
  [`index.html:989`](../../public/index.html#L989)

**CSS 样式**

- 各工具类型专用样式（终端深色、diff 红绿、搜索黄色、代理紫色、任务青色）
  [`index.html:387`](../../public/index.html#L387)
