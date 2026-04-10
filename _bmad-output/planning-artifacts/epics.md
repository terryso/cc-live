---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
---

# cc-watch - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for cc-watch, decomposing the requirements from the PRD into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR1: 系统能将 AI thinking 块以 markdown 格式渲染（支持代码块、列表、粗体、链接等）
- FR2: 系统能在 thinking 渲染中保留语法高亮（代码片段）
- FR3: 系统能对超过 500 字符的 thinking 内容截断显示，提供展开按钮查看完整内容
- FR4: 系统能识别不同工具类型，为每种工具提供专用显示格式
- FR5: 系统能将 Bash 工具的 command 参数以终端命令风格展示
- FR6: 系统能将 Read 工具的 file_path 和行范围信息格式化展示
- FR7: 系统能将 Edit 工具的 file_path、old_string、new_string 以 diff 风格展示
- FR8: 系统能将 Write 工具的 file_path 和前 10 行内容预览格式化展示
- FR9: 系统能将 Grep/Glob 工具的搜索模式和路径范围格式化展示
- FR10: 系统能将 Agent 工具的子代理类型、描述和摘要格式化展示
- FR11: 系统能将 TodoWrite 工具的任务列表以结构化格式展示
- FR12: 系统能将 WebSearch 工具的搜索关键词格式化展示
- FR13: 系统能对未知工具类型回退到通用 JSON 格式化展示
- FR14: 系统能根据内容特征（括号密度、缩进模式、语言标识符）自动检测工具返回结果的内容类型
- FR15: 系统能将代码类型的工具结果以语法高亮展示
- FR16: 系统能将 JSON 类型的工具结果以格式化缩进展示
- FR17: 系统能将纯文本类型的工具结果以 markdown 渲染展示
- FR18: 系统能确保所有动态内容经过 HTML 转义或净化处理后再渲染
- FR19: 系统能确保工具专用格式化器输出的 HTML 不含未转义的用户内容

### NonFunctional Requirements

- NFR1: 单条消息渲染时间不超过 50ms（含 markdown 解析 + HTML 净化 + DOM 插入）
- NFR2: SSE 消息流推送间隔不受渲染逻辑影响——新消息到达后立即显示
- NFR3: 超长内容（>5000 字符的 thinking 或工具结果）渲染不阻塞主线程
- NFR4: 页面滚动流畅度不受消息渲染影响——60fps 无掉帧
- NFR5: 所有经过 markdown 渲染的内容必须通过 HTML 净化处理
- NFR6: 工具专用格式化器的所有动态输出必须经过 HTML 实体转义
- NFR7: 不允许在渲染管线中引入新的未净化 HTML 注入点

### Additional Requirements

无架构文档。技术约束来自 PRD Technical Requirements 章节：
- 单 HTML 文件 SPA，零外部依赖
- 使用已有 `marked` + `highlight.js` + `DOMPurify`
- 改动集中在 `public/index.html` 的 `msgContent()` 函数及其周边

### UX Design Requirements

无 UX 设计文档。工具格式视觉示例来自 PRD FR4 章节。

### FR Coverage Map

| FR | Epic | 说明 |
|----|------|------|
| FR1 | Epic 1 | Thinking markdown 渲染 |
| FR2 | Epic 1 | Thinking 代码语法高亮 |
| FR3 | Epic 1 | Thinking 截断/展开 |
| FR4 | Epic 2 | 工具类型识别 + 专用格式路由 |
| FR5 | Epic 2 | Bash 终端风格展示 |
| FR6 | Epic 2 | Read 文件路径+行范围展示 |
| FR7 | Epic 2 | Edit diff 风格展示 |
| FR8 | Epic 2 | Write 文件路径+内容预览展示 |
| FR9 | Epic 2 | Grep/Glob 搜索格式展示 |
| FR10 | Epic 2 | Agent 子代理格式展示 |
| FR11 | Epic 2 | TodoWrite 任务列表展示 |
| FR12 | Epic 2 | WebSearch 搜索关键词展示 |
| FR13 | Epic 2 | 未知工具 JSON 兜底展示 |
| FR14 | Epic 3 | 内容类型自动检测 |
| FR15 | Epic 3 | 代码结果语法高亮 |
| FR16 | Epic 3 | JSON 结果格式化缩进 |
| FR17 | Epic 3 | 纯文本结果 markdown 渲染 |
| FR18 | 全部 Epic | HTML 净化（横切安全约束） |
| FR19 | 全部 Epic | 格式化器输出安全（横切安全约束） |
| FR20 | Epic 4 | 弹幕 API + 文件持久化 |
| FR21 | Epic 4 | 随机昵称生成 + localStorage |
| FR22 | Epic 4 | 弹幕输入 UI（文字 + emoji） |
| FR23 | Epic 4 | 弹幕/昵称长度限制 |
| FR24 | Epic 4 | 弹幕 CSS 飘屏 + 历史回放 |

## Epic List

### Epic 1: Thinking 推理可读化
用户能清晰阅读 AI 的推理过程——代码片段有语法高亮、步骤有编号、关键决策有粗体，而不是一坨灰色纯文本。
**FRs covered:** FR1, FR2, FR3

### Epic 2: 工具操作可视化
用户一眼看清 AI 执行了什么操作——Bash 像终端命令、Edit 显示 diff、Read 显示文件路径和行号，而不是原始 JSON。
**FRs covered:** FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, FR12, FR13

### Epic 3: 工具结果智能渲染
工具返回的内容根据类型智能展示——代码有语法高亮、JSON 有缩进格式化、纯文本有 markdown 渲染，用户能理解工具返回了什么。
**FRs covered:** FR14, FR15, FR16, FR17

### 横切关注点: 渲染安全
**FRs covered:** FR18, FR19 — 贯穿所有 Epic 的安全约束

---

## Epic 1: Thinking 推理可读化

**目标：** 将 thinking 块从 `esc()` 纯文本输出升级为 markdown 渲染，让 AI 的推理过程清晰可读。

**FRs:** FR1, FR2, FR3
**横切安全：** FR18, FR19

### Story 1.1: Thinking 块 Markdown 渲染

As a 直播观众,
I want 看到 AI 的 thinking 内容以 markdown 格式渲染（代码块、列表、粗体、链接）,
So that 我能快速理解 AI 的推理逻辑，而不是看一坨纯文本。

**Acceptance Criteria:**

**Given** 一条消息包含 `type: "thinking"` 的 content block
**When** 系统渲染该消息
**Then** thinking 内容通过 `renderMd()` 进行 markdown 渲染，而非 `esc()` 纯文本输出
**And** 渲染结果支持：代码块（围栏语法）、有序/无序列表、粗体/斜体、超链接
**And** 渲染后的 HTML 经过 DOMPurify 净化处理（FR18）
**And** 现有的 thinking 视觉样式（灰色背景、斜体标识）保持不变

**FRs:** FR1, FR18
**NFRs:** NFR1, NFR5

### Story 1.2: Thinking 代码片段语法高亮

As a 开发者,
I want thinking 中的代码片段有语法高亮,
So that 我能一眼区分推理文字和代码示例。

**Acceptance Criteria:**

**Given** thinking 内容中包含围栏代码块（如 \`\`\`javascript）
**When** 系统渲染该 thinking 块
**Then** 代码块通过 highlight.js 进行语法高亮
**And** 代码块的背景色与 thinking 区域有视觉区分
**And** 未知语言的代码块仍以等宽字体展示（不高亮但不报错）

**FRs:** FR2
**NFRs:** NFR1

### Story 1.3: Thinking 长内容截断与展开

As a 回看者,
I want 超长 thinking 内容默认折叠，点击可展开查看全部,
So that 消息流不会因为单个 thinking 块过长而难以浏览。

**Acceptance Criteria:**

**Given** thinking 内容长度超过 500 字符
**When** 系统渲染该 thinking 块
**Then** 默认只显示前 500 字符的渲染内容，并在末尾显示"展开"按钮
**And** 点击"展开"按钮后显示完整内容，按钮文字变为"收起"
**And** 点击"收起"后恢复截断状态
**And** 长度 ≤ 500 字符的 thinking 块正常显示，无截断按钮
**And** 截断和展开操作不重新触发 markdown 解析（使用缓存的渲染结果）

**FRs:** FR3
**NFRs:** NFR3, NFR4

---

## Epic 2: 工具操作可视化

**目标：** 每种工具调用都有专用格式化展示，用户一眼看清 AI 做了什么操作，而不是看原始 JSON。

**FRs:** FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, FR12, FR13
**横切安全：** FR18, FR19

### Story 2.1: 工具类型识别框架与兜底格式化

As a 观众,
I want 每个工具调用都有清晰的专用格式展示,
So that 我能一眼区分不同类型的操作，而不是所有工具调用看起来都是 JSON。

**Acceptance Criteria:**

**Given** 一条消息包含 `type: "tool_use"` 的 content block，工具名为 `name`
**When** 系统渲染该工具调用
**Then** 系统根据 `name` 字段路由到对应的专用格式化器
**And** 对于未识别的工具名，回退到通用 JSON 格式化展示（缩进、语法高亮）
**And** 每种格式化器的动态输出都经过 HTML 实体转义（FR19）
**And** 格式化器返回的 HTML 不含未转义的用户内容

**FRs:** FR4, FR13, FR19
**NFRs:** NFR6, NFR7

### Story 2.2: Bash 工具终端风格展示

As a 开发者,
I want Bash 工具调用显示为终端命令风格,
So that 我一眼就能看出 AI 执行了什么命令。

**Acceptance Criteria:**

**Given** 工具调用 name 为 `Bash`，参数包含 `command`
**When** 系统渲染该工具调用
**Then** 显示为终端样式：深色背景、`$` 前缀、等宽字体
**And** command 参数内容以纯文本展示（经过 HTML 转义）
**And** 格式示例：`$ git status`

**FRs:** FR5

### Story 2.3: Read/Write 工具文件操作展示

As a 开发者,
I want Read 和 Write 工具调用显示文件路径和操作范围,
So that 我能快速知道 AI 读了哪个文件、写了什么内容。

**Acceptance Criteria:**

**Given** 工具调用 name 为 `Read`，参数包含 `file_path`
**When** 系统渲染该 Read 工具调用
**Then** 显示文件图标 `📄` + 文件路径
**And** 如果参数包含 `offset` 和 `limit`，显示行范围（如 `L10-L50`）
**And** 格式示例：`📄 src/lib.js (L10-L50)`

**Given** 工具调用 name 为 `Write`，参数包含 `file_path` 和 `content`
**When** 系统渲染该 Write 工具调用
**Then** 显示文件图标 `📝` + 文件路径
**And** content 的前 10 行以代码块预览展示
**And** 格式示例：`📝 src/new-file.js` + 前 10 行代码预览

**FRs:** FR6, FR8

### Story 2.4: Edit 工具 Diff 风格展示

As a 开发者,
I want Edit 工具调用以 diff 风格展示文件修改,
So that 我能一眼看出 AI 删了什么、加了什么。

**Acceptance Criteria:**

**Given** 工具调用 name 为 `Edit`，参数包含 `file_path`、`old_string`、`new_string`
**When** 系统渲染该 Edit 工具调用
**Then** 显示文件图标 `✏️` + 文件路径
**And** `old_string` 内容以红色背景（删除行）展示
**And** `new_string` 内容以绿色背景（添加行）展示
**And** 所有动态内容经过 HTML 转义，防止注入
**And** 格式示例：`✏️ src/lib.js` + 红/绿 diff 块

**FRs:** FR7, FR18

### Story 2.5: Grep/Glob 搜索工具展示

As a 开发者,
I want Grep 和 Glob 工具调用显示搜索关键词和搜索范围,
So that 我能知道 AI 在找什么。

**Acceptance Criteria:**

**Given** 工具调用 name 为 `Grep`，参数包含 `pattern`
**When** 系统渲染该 Grep 工具调用
**Then** 显示搜索图标 `🔍` + 搜索关键词（引号包裹）
**And** 如果参数包含 `path`，显示搜索目录
**And** 格式示例：`🔍 "pattern" in src/`

**Given** 工具调用 name 为 `Glob`，参数包含 `pattern`
**When** 系统渲染该 Glob 工具调用
**Then** 显示搜索图标 `🔍` + glob 模式（引号包裹）
**And** 如果参数包含 `path`，显示搜索目录

**FRs:** FR9

### Story 2.6: Agent 子代理展示

As a 观众,
I want Agent 工具调用显示子代理的类型和描述,
So that 我能理解 AI 派了什么子任务给子代理。

**Acceptance Criteria:**

**Given** 工具调用 name 为 `Agent`，参数包含 `description`（可选）和 `prompt`
**When** 系统渲染该 Agent 工具调用
**Then** 显示机器人图标 `🤖` + description 文本（如 `search codebase`）
**And** 如果 description 缺失，截取 prompt 前 50 字符作为摘要
**And** 格式示例：`🤖 Explore (search codebase)`

**FRs:** FR10

### Story 2.7: TodoWrite 任务列表展示

As a 开发者,
I want TodoWrite 工具调用以结构化任务列表展示,
So that 我能看清 AI 当前的任务规划和进度。

**Acceptance Criteria:**

**Given** 工具调用 name 为 `TodoWrite`，参数包含 `todos` 数组
**When** 系统渲染该 TodoWrite 工具调用
**Then** 以勾选框列表格式展示所有任务项
**And** `status: "completed"` 的任务显示为勾选状态（☑）
**And** `status: "in_progress"` 的任务显示为进行中（☐ ●）
**And** `status: "pending"` 的任务显示为待办（☐）
**And** 每个任务显示 `content` 文本

**FRs:** FR11

### Story 2.8: WebSearch 搜索展示

As a 开发者,
I want WebSearch 工具调用显示搜索关键词,
So that 我能知道 AI 在搜索什么信息。

**Acceptance Criteria:**

**Given** 工具调用 name 为 `WebSearch`，参数包含 `query`
**When** 系统渲染该 WebSearch 工具调用
**Then** 显示搜索图标 `🌐` + 搜索关键词（引号包裹）
**And** 格式示例：`🌐 "search query"`

**FRs:** FR12

---

## Epic 3: 工具结果智能渲染

**目标：** 工具返回结果根据内容类型智能展示，代码有语法高亮、JSON 有格式化缩进、纯文本有 markdown 渲染。

**FRs:** FR14, FR15, FR16, FR17
**横切安全：** FR18, FR19

### Story 3.1: 工具结果内容类型自动检测

As a 系统,
I want 自动检测工具返回结果的内容类型,
So that 不同类型的工具结果可以用最合适的方式渲染。

**Acceptance Criteria:**

**Given** 一条消息包含 `type: "tool_result"` 的 content block
**When** 系统准备渲染该工具结果
**Then** 通过内容特征自动检测类型：
- **代码：** 包含语言标识符的代码围栏（如 \`\`\`python），或高比例缩进行 + 语言特征关键字
- **JSON：** 以 `{` 或 `[` 开头，括号配对率高（>80%），键值对模式匹配
- **纯文本/markdown：** 不符合以上两种模式的内容
**And** 检测结果传递给对应的渲染器（高亮/格式化/markdown）

**FRs:** FR14
**NFRs:** NFR1

### Story 3.2: 代码类型结果语法高亮

As a 开发者,
I want 工具结果中的代码有语法高亮,
So that 我能像在 IDE 中一样阅读代码。

**Acceptance Criteria:**

**Given** 工具结果被检测为代码类型
**When** 系统渲染该工具结果
**Then** 代码内容通过 highlight.js 进行语法高亮
**And** 如果检测到语言标识符，使用对应语言的语法规则
**And** 如果未检测到语言，使用自动检测模式
**And** 渲染结果经过 DOMPurify 净化处理

**FRs:** FR15, FR18
**NFRs:** NFR5

### Story 3.3: JSON 类型结果格式化展示

As a 开发者,
I want 工具结果中的 JSON 数据格式化缩进展示,
So that 我能看清 JSON 的层级结构。

**Acceptance Criteria:**

**Given** 工具结果被检测为 JSON 类型
**When** 系统渲染该工具结果
**Then** JSON 内容以 2 空格缩进格式化展示
**And** 格式化后的 JSON 以代码块样式展示（等宽字体、可选语法高亮）
**And** 无效 JSON 降级为纯文本 markdown 渲染（不报错）
**And** 所有内容经过 HTML 转义

**FRs:** FR16, FR18

### Story 3.4: 纯文本类型结果 Markdown 渲染

As a 观众,
I want 纯文本类型的工具结果以 markdown 渲染,
So that 普通文本内容也有合适的格式（列表、粗体、链接等）。

**Acceptance Criteria:**

**Given** 工具结果被检测为纯文本/markdown 类型
**When** 系统渲染该工具结果
**Then** 内容通过 `renderMd()` 进行 markdown 渲染
**And** 渲染结果经过 DOMPurify 净化处理
**And** 渲染效果与 thinking 块的 markdown 渲染一致（复用同一渲染管线）

**FRs:** FR17, FR18
**NFRs:** NFR5

---

## Epic 4: 弹幕互动系统

**目标：** 在分享页增加弹幕功能，让观众通过飘过的弹幕参与互动，营造直播氛围。弹幕按时间先后顺序持续飘出，历史弹幕在页面加载时自动回放。

**FRs:** FR20, FR21, FR22, FR23, FR24
**横切安全：** FR18

### Story 4.1: 弹幕后端 API 与数据存储

As a 系统,
I want 提供弹幕的创建和查询 API，并将弹幕持久化到文件,
So that 弹幕数据不丢失，回放时可以加载历史弹幕。

**Acceptance Criteria:**

**Given** 一个有效的 share token 对应的项目会话
**When** 观众通过 POST `/api/danmaku` 提交弹幕（包含 `sessionId`、`nickname`、`content`）
**Then** 服务端将弹幕存入 `data/danmaku/{sessionId}.json`，每条记录包含 `{id, nickname, content, timestamp}`
**And** 弹幕内容长度限制 200 字符，超出截断
**And** nickname 长度限制 20 字符
**And** 弹幕内容经过 HTML 实体转义后再存储（FR18）
**And** 新弹幕通过 SSE `danmaku` 事件广播给该会话的所有连接客户端

**Given** 一个有效的 share token
**When** 观众通过 GET `/api/danmaku?sessionId=xxx` 请求历史弹幕
**Then** 返回该会话的所有历史弹幕，按 timestamp 升序排列
**And** 非分享页访问（无有效 token）返回 403

**FRs:** FR20, FR18
**NFRs:** 零外部依赖，使用 Node.js 内置 `fs/promises`

### Story 4.2: 昵称管理

As a 观众,
I want 进入分享页时自动获得一个随机昵称，且可以随时修改,
So that 我有身份感但不需要注册登录。

**Acceptance Criteria:**

**Given** 观众首次打开分享页
**When** 页面加载完成
**Then** 系统自动生成一个随机昵称（格式：形容词+名词，如"快乐水豚"），显示在弹幕输入框旁
**And** 昵称通过 localStorage 持久化，刷新页面不丢失

**Given** 观众点击昵称
**When** 修改昵称并确认
**Then** 昵称更新并保存到 localStorage
**And** 后续发送的弹幕使用新昵称
**And** 昵称长度限制 20 字符

**FRs:** FR21

### Story 4.3: 弹幕输入与发送 UI

As a 观众,
I want 在分享页底部有一个弹幕输入框，输入文字或 emoji 后发送弹幕,
So that 我能方便地参与互动。

**Acceptance Criteria:**

**Given** 观众在分享页
**When** 页面加载完成
**Then** 页面底部显示弹幕输入区域：昵称显示 + 文本输入框 + emoji 选择器 + 发送按钮
**And** 输入框 placeholder 为"发条弹幕..."
**And** 输入框最大 200 字符，超出时无法继续输入

**Given** 观众在输入框中输入内容
**When** 按回车或点击发送按钮
**Then** 弹幕发送到服务端，输入框清空
**And** 发送成功后自己的弹幕立即在屏幕上飘出
**And** 空内容不发送

**Given** 观众点击 emoji 选择器
**When** 选择一个 emoji
**Then** emoji 插入到输入框光标位置

**FRs:** FR22, FR23

### Story 4.4: 弹幕飘屏渲染

As a 观众,
I want 看到弹幕从屏幕右侧飘到左侧，像B站弹幕一样,
So that 直播氛围感更强。

**Acceptance Criteria:**

**Given** 一条弹幕到达（实时推送或历史回放）
**When** 系统渲染该弹幕
**Then** 弹幕从屏幕右侧飘入，匀速移动到左侧消失
**And** 弹幕样式：半透明背景色、昵称用不同颜色高亮、内容文字清晰可读
**And** 多条弹幕垂直错开，避免完全重叠
**And** 弹幕使用 CSS animation 实现，不占用 JS 主线程（60fps 流畅）
**And** 屏幕上同时飘过的弹幕不超过 15 条，超出排队等待

**Given** 页面首次加载
**When** 历史弹幕加载完成
**Then** 历史弹幕一次性快速铺开——所有弹幕同时开始飘动，各自带随机垂直位置和随机动画延迟（0-3 秒），几秒内全部飘完
**And** 历史弹幕和实时弹幕走同一个飘屏队列，互不阻塞
**And** 用户自己发的弹幕立即飘出，不排队等历史弹幕

**Given** 观众点击弹幕开关按钮
**When** 关闭弹幕
**Then** 屏幕上所有飘动中的弹幕立即消失，新弹幕不再飘出（排队但不渲染）
**And** 弹幕输入区域保持可见，仍可发送弹幕
**When** 重新开启弹幕
**Then** 排队中的弹幕和后续新弹幕恢复飘出

**FRs:** FR24

---

## Requirements Addendum

### 新增功能需求（Epic 4）

- FR20: 系统能提供弹幕的创建（POST）和查询（GET）API，弹幕数据持久化到文件系统
- FR21: 系统能为观众自动生成随机昵称，支持修改，通过 localStorage 持久化
- FR22: 系统能在分享页提供弹幕输入 UI，支持文字和 emoji 输入
- FR23: 系统能限制弹幕内容长度（200 字符）和昵称长度（20 字符）
- FR24: 系统能将弹幕以 CSS 动画方式从右侧飘到左侧渲染，支持历史回放和实时推送，并提供弹幕开关按钮

---

## Validation Summary

### FR Coverage: 24/24 ✅

- Epic 1: FR1, FR2, FR3 (3 FRs)
- Epic 2: FR4, FR5, FR6, FR7, FR8, FR9, FR10, FR11, FR12, FR13 (10 FRs)
- Epic 3: FR14, FR15, FR16, FR17 (4 FRs)
- Epic 4: FR20, FR21, FR22, FR23, FR24 (5 FRs)
- 横切: FR18, FR19 (覆盖所有 Epic)

### Story Count: 19 Stories

- Epic 1: 3 stories
- Epic 2: 8 stories
- Epic 3: 4 stories
- Epic 4: 4 stories

### Dependency Check ✅

- Epic 1 → 独立，无前置依赖
- Epic 2 → 独立，无前置依赖
- Epic 3 → 独立，无前置依赖
- Epic 4 → 独立，无前置依赖（仅需分享页基础设施已就绪，当前已实现）
- 每个 Epic 内的 stories 按序号递进：
  - Epic 4: 4.1（后端） → 4.2（昵称） → 4.3（输入UI） → 4.4（飘屏渲染）
  - 4.2 和 4.1 可并行；4.3 依赖 4.1 和 4.2；4.4 依赖 4.1

### Quality Check ✅

- 每个 story 可由单个 dev agent 完成
- 每个 story 有 Given/When/Then 验收标准
- 无技术层组织（全部按用户价值分组）
- 无"建所有表"式的前置 story
