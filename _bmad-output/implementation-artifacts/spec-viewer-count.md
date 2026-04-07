---
title: 'Real-time viewer count display'
type: 'feature'
created: '2026-04-07'
status: 'done'
baseline_commit: 'e5c66f1'
context:
  - '_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 观看者和分享链接观众无法知道当前有多少人同时在围观，缺乏直播场景下的社交感知。

**Approach:** 后端在每次 SSE 连接建立或断开时，向所有客户端广播当前在线人数（`clients.size`）。前端在 sidebar header 状态行显示 `● Live · N viewing`。

## Boundaries & Constraints

**Always:**
- 使用 SSE 广播机制推送（现有 `broadcast()` 有项目过滤不适用，用独立 `broadcastViewerCount()`），不新增轮询机制
- 围观人数对所有人可见（本地 + 分享链接）
- 新客户端连接时立即发送当前人数（不等下一次广播）

**Ask First:**
- 是否需要按项目分组显示人数（如"此项目 3 人围观"）

**Never:**
- 不引入任何 npm 包
- 不持久化围观人数（纯实时状态）
- 不增加心跳频率来传递人数

</frozen-after-approval>

## Code Map

- `server.js:35` -- `clients` Map，`clients.size` 即在线人数
- `server.js:53-60` -- `broadcast()` 函数，已有项目过滤逻辑
- `server.js:388-400` -- SSE 连接建立处，需广播人数 + 向新客户端发送当前人数
- `server.js:400` -- `req.on("close", ...)` 断开处理，需广播人数更新
- `public/index.html:88` -- sidebar-hd 状态行，显示位置

## Tasks & Acceptance

**Execution:**
- [x] `server.js` -- 新增 `broadcastViewerCount()` 函数，调用 `sseSend` 向所有客户端发送 `viewer_count` 事件（`{ count: clients.size }`）；在 SSE 连接建立后（line ~397）和连接断开时（`close` handler 内）调用此函数 -- 实时推送在线人数
- [x] `public/index.html` -- 添加 `viewer_count` SSE 事件监听器，更新 sidebar-hd 状态行显示为 `Connected · N viewing`；连接/断开时动态更新文字 -- 前端显示围观人数

**Acceptance Criteria:**
- Given 服务端启动无客户端, when 第一个 SSE 连接建立, then 所有客户端收到 `viewer_count` 事件，count=1
- Given 有 3 个客户端连接, when 1 个断开, then 剩余客户端收到 count=2
- Given 分享链接观众, when SSE 连接成功, then 看到包含围观人数的状态显示
- Given 只有 1 个客户端, when 收到 viewer_count, then 显示 "1 viewing"（单数）

## Spec Change Log

### Review Findings

- [x] [Review][Patch] 状态文字 "Connected" 改为 "Live" [`index.html:182`](../../public/index.html#L182) — 已修复
- [x] [Review][Defer] Debounce `broadcastViewerCount()` [`server.js:64`](../../server.js#L64) — deferred, pre-existing pattern
- [x] [Review][Defer] `res.write()` 错误可致进程崩溃 [`server.js:42`](../../server.js#L42) — deferred, pre-existing issue

## Verification

**Manual checks:**
- 启动 `node server.js`，打开浏览器，确认状态行显示 "Live · 1 viewing"
- 再开一个标签页访问同一地址，确认两个页面都更新为 "2 viewing"
- 关闭一个标签页，确认另一页面变回 "1 viewing"
- 用分享链接访问，确认也能看到围观人数

## Suggested Review Order

- 广播函数：遍历所有客户端发送 `viewer_count` 事件，无项目过滤
  [`server.js:64`](../../server.js#L64)

- 断开时：先删除客户端再广播更新计数
  [`server.js:406`](../../server.js#L406)

- 连接时：注册后立即广播当前计数
  [`server.js:407`](../../server.js#L407)

- 前端监听器：解析 `viewer_count` 事件，更新状态行（含 try/catch 防御）
  [`index.html:181`](../../public/index.html#L181)
