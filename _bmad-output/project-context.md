---
project_name: 'cc-watch'
user_name: 'Nick'
date: '2026-04-07'
sections_completed:
  - technology_stack
  - language_rules
  - framework_rules
  - testing_rules
  - code_quality
  - workflow_rules
  - critical_rules
existing_patterns_found: 6
status: 'complete'
rule_count: 45
optimized_for_llm: true
---

# Project Context for AI Agents

_This文件包含 AI Agent 在本项目中编写代码时必须遵循的关键规则和模式。重点关注容易被忽略的细节。_

---

## Technology Stack & Versions

- **运行时：** Node.js v23+，ES Modules（`"type": "module"`）
- **零外部依赖：** 禁止引入任何 npm 包，所有功能必须用 Node.js 内置模块实现
- **内置模块：** `http`、`fs/promises`、`path`、`os`
- **前端：** 内联 HTML/CSS/JS 单页应用（无框架、无构建工具、无打包器）
- **实时通信：** SSE（Server-Sent Events）
- **数据源：** Claude Code 本地 JSONL 会话文件（`~/.claude/projects/`）

---

## Language-Specific Rules

### ES Module 规范
- 必须使用 `import/export` 语法，**禁止** `require()`/`module.exports`
- 文件顶层使用 `import { ... } from "..."` 具名导入
- 异步操作使用 `async/await`，不用 `.then()` 链式调用

### 字符串与编码
- 使用模板字面量（`` ` ``）构建多行字符串（如 HTML 输出）
- 文件读取使用 `"utf8"` 编码

### 错误处理
- 文件系统操作使用空 `catch {}` 静默处理（项目风格：扫描/监控容错优先）
- HTTP 路由不使用 try/catch，依赖 `res.writeHead` + `res.end` 直接响应
- `res.writableEnded` 检查防止向已关闭连接写入数据

### 变量与常量约定
- 常量：`UPPER_SNAKE_CASE`（如 `PORT`、`MAX_WATCHED`、`FRONTEND_HTML`）
- 变量/函数：`camelCase`（如 `watchFile`、`extractDisplayMessage`）
- 文件名：`kebab-case`（如 `server.js`）
- 段落注释风格：`// ── Section Name ──`

---

## Framework-Specific Rules

> 本项目无框架，使用原生 Node.js HTTP server。

### HTTP Server 模式
- 使用 `createServer` 创建服务器，不使用 Express/Koa 等框架
- 路由通过 `URL` + `pathname` 匹配实现
- 所有响应必须设置 `Access-Control-Allow-Origin: *`（CORS）

### SSE 实现要求
- SSE 响应头：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`
- 消息格式：`event: {name}\ndata: {json}\n\n`
- 心跳保活：每 15 秒发送 `": heartbeat\n\n"` 注释行
- 客户端断开时必须清理（`req.on("close", ...)`）

### 文件监控模式
- 使用 `setInterval` 轮询（非 `fs.watch`），间隔 500ms
- 通过文件 `size` offset 追踪新内容（只读增量）
- 会话文件每 10 秒重新扫描一次（`discoverAndWatch`）
- 最多同时监控 20 个会话文件（`MAX_WATCHED`）

### 内存管理
- 会话消息上限 500 条，超出后裁剪到 300 条（`slice(-300)`）
- 客户端连接使用 `Map` 管理，断开时删除

---

## Testing Rules

- 当前项目无测试框架和测试文件
- 如需添加测试，建议使用 Node.js 内置 `node:test`（保持零依赖原则）
- 测试应覆盖：JSONL 解析（`parseLine`、`extractDisplayMessage`）、路由响应、SSE 消息格式

---

## Code Quality & Style Rules

### 文件架构
- **单文件架构：** 所有后端逻辑和前端 HTML 在 `server.js` 中
- 前端 HTML 存储在 `FRONTEND_HTML` 常量中，作为模板字面量
- CSS 使用 CSS 变量（`:root`）定义主题色，不使用预处理器

### 命名与组织
- 代码分区使用注释段：`// ── Section ───────` 分隔
- 逻辑分区顺序：Config → State → Helpers → Core Logic → HTTP Server → Frontend → Startup
- 函数保持简洁，单职责

### 前端风格
- 不使用框架，原生 DOM 操作
- XSS 防护：使用 `esc()` 函数转义 HTML 实体
- 等宽字体：`SF Mono, Fira Code, Menlo, monospace`
- 深色主题，CSS 变量控制

---

## Development Workflow Rules

- 分支：`main` 为主分支
- 提交信息风格：简洁英文（如 `Initial commit: CC Watch - live viewer for Claude Code sessions`）
- 启动命令：`node server.js` 或 `npm start`
- 公网分享：通过 `cloudflared tunnel --url http://localhost:3456`
- 配置通过环境变量：`CC_WATCH_PORT`、`CLAUDE_DIR`

---

## Critical Don't-Miss Rules

### 绝对禁止
- **禁止引入 npm 依赖** — 这是核心设计约束，所有功能必须用内置模块
- **禁止使用 `require()`** — 项目使用 ES Modules
- **禁止在前端渲染中省略 `esc()` 转义** — 防止 XSS

### SSE 关键细节
- SSE 数据必须是 JSON 字符串（`JSON.stringify`）
- 心跳使用 SSE 注释格式（`:` 前缀），不触发前端 `addEventListener`
- 检查 `res.writableEnded` 避免向已关闭连接写入

### JSONL 解析关键细节
- 跳过类型：`queue-operation`、`file-history-snapshot`、`change`、`last-prompt`（`SKIP_TYPES`）
- 跳过以 `<local-command-caveat>` 或 `<command-name>` 开头的用户消息
- 思考内容截断到 500 字符，工具参数截断到 300 字符
- 工具结果截断到 500 字符

### 文件路径处理
- Claude 项目目录名格式：`-Users-nick-projects-foo` → 解析为 `/Users/nick/projects/foo`
- 解析逻辑：`dir.replace(/^-/, "").replace(/-/g, "/").replace(/^\//, "")`
- 会话 ID 为 JSONL 文件名去掉 `.jsonl` 后缀

### 前端自动滚动
- 仅当用户接近底部时（`scrollHeight - scrollTop - clientHeight < 200`）才自动滚动
- 不要在用户向上浏览时强制滚动到底部

---

## Usage Guidelines

**AI Agent 使用：**
- 实现代码前先阅读此文件
- 严格遵循所有规则
- 有疑问时选择更保守的方案

**维护：**
- 技术栈变化时更新
- 定期移除已成为常识的规则

Last Updated: 2026-04-07
