---
title: 'Epic 4: 弹幕互动系统'
type: 'feature'
created: '2026-04-10'
status: 'done'
baseline_commit: '7fe6d1e'
context:
  - _bmad-output/planning-artifacts/epics.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 分享页是纯被动观看体验，观众无法参与互动，缺乏直播氛围感。

**Approach:** 在分享页添加弹幕系统——观众可输入文字/emoji 发送弹幕，弹幕以 CSS 动画从右向左飘过屏幕，同时支持历史弹幕回放。后端提供 API + 文件持久化，通过 SSE 实时广播新弹幕。

## Boundaries & Constraints

**Always:** 所有用户输入（弹幕内容、昵称）必须 HTML 实体转义后存储和渲染；弹幕动画使用纯 CSS animation（不占 JS 主线程）；同屏弹幕上限 15 条；零外部依赖。

**Ask First:** SSE 事件格式变更；弹幕发送频率限制策略。

**Never:** 弹幕审核/过滤系统；弹幕线程/回复功能；用户注册/登录；非分享页显示弹幕。

</frozen-after-approval>

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 发送弹幕 | POST `{sessionId, nickname, content}`，有效 share token | 存入 `data/danmaku/{sessionId}.json`，SSE 广播 `danmaku` 事件 | 无 token/无效 token → 403；空内容 → 400；超长截断至 200 字符 |
| 加载历史 | GET `/api/danmaku?sessionId=xxx`，有效 token | 返回按 timestamp 升序的弹幕数组 | 无 token → 403 |
| 首次打开 | localStorage 无昵称 | 自动生成 "形容词+名词" 随机昵称 | — |
| 修改昵称 | 点击昵称输入新值 | 保存到 localStorage，后续弹幕用新昵称 | 超 20 字符截断 |
| 同屏弹幕满 | 第 16 条弹幕到达 | 排队等待，有弹幕飘完后释放 | — |
| 弹幕开关关闭 | 点击关闭 | 飘动中的弹幕立即消失，新弹幕排队不渲染 | — |
| 弹幕开关开启 | 点击开启 | 排队弹幕 + 新弹幕恢复飘出 | — |

## Code Map

- `server.js` -- HTTP 服务器，路由分发，SSE 广播，share token 验证
- `lib.js` -- 工具函数（HTML 转义等）
- `public/index.html` -- 前端入口 HTML + 内联样式
- `public/js/api.js` -- SSE 连接 + API 调用
- `public/js/state.js` -- 前端全局状态
- `public/js/render.js` -- 消息渲染
- `public/js/utils.js` -- 前端工具函数

## Tasks & Acceptance

**Execution:**

- [x] `server.js` -- 添加 POST `/api/danmaku`（创建弹幕）和 GET `/api/danmaku`（查询历史）端点，包含 share token 验证、内容截断、HTML 转义；新弹幕通过 `broadcast("danmaku", ...)` 广播 -- 弹幕后端核心
- [x] `server.js` -- 添加 `loadDanmaku(sessionId)` / `saveDanmaku(sessionId)` 函数，持久化到 `data/danmaku/{sessionId}.json`，每条记录 `{id, nickname, content, timestamp}` -- 数据持久化
- [x] `public/js/danmaku.js` -- 新建弹幕模块：随机昵称生成器（形容词+名词）、localStorage 昵称管理、弹幕发送 API 调用、弹幕队列管理（同屏上限 15）、CSS 动画飘屏渲染、历史弹幕回放（随机延迟铺开）、弹幕开关 -- 弹幕前端核心
- [x] `public/js/api.js` -- 在 SSE `connect()` 中添加 `danmaku` 事件监听，调用 danmaku 模块的渲染函数；在 `share-info` 事件处理后加载历史弹幕 -- SSE 弹幕推送
- [x] `public/js/state.js` -- 添加 `isDanmakuOn` 状态（默认 true）和对应的 setter -- 弹幕开关状态
- [x] `public/index.html` -- 添加弹幕 UI：底部输入栏（昵称显示/编辑 + 文本框 + emoji 选择器 + 发送按钮）、弹幕开关按钮、弹幕飘屏容器（`#danmaku-layer`）、CSS animation 定义（右→左飘动）、弹幕样式（半透明背景、昵称颜色高亮） -- 弹幕 UI 和样式

**Acceptance Criteria:**

- Given 观众通过有效 share token 打开分享页，when 页面加载完成，then 底部显示弹幕输入区域（昵称 + 输入框 + emoji + 发送按钮），历史弹幕自动回放
- Given 观众输入弹幕内容并按回车/点击发送，when 弹幕发送成功，then 自己的弹幕立即在屏幕飘出，其他观众通过 SSE 实时收到
- Given 屏幕上已有 15 条弹幕，when 第 16 条到达，then 新弹幕排队等待，有弹幕飘完后释放
- Given 观众点击弹幕开关关闭，when 弹幕关闭，then 所有飘动弹幕立即消失，新弹幕排队但不渲染，输入区域仍可见
- Given 所有用户输入内容（弹幕、昵称），when 渲染到页面，then 内容经过 HTML 实体转义，无 XSS 风险

## Verification

**Commands:**
- `node server.js` -- 启动服务器无报错，弹幕 API 端点响应正常
- `curl -X POST http://localhost:3456/api/danmaku -H "Content-Type: application/json" -d '{"sessionId":"test","nickname":"test","content":"hello"}'` -- 返回 403（无 token）
- `curl http://localhost:3456/api/danmaku?sessionId=test` -- 返回 403（无 token）

**Manual checks:**
- 打开分享页，确认弹幕输入区域可见，昵称自动生成
- 发送弹幕后确认弹幕从右侧飘到左侧
- 点击弹幕开关确认开关功能正常
- 检查 `data/danmaku/` 目录下生成弹幕文件

## Suggested Review Order

**后端 API 与安全**

- Danmaku 持久化 + HTML 转义入口
  [`server.js:118`](../../server.js#L118)

- GET/POST 端点，含 sessionId 校验 + share scope 验证
  [`server.js:442`](../../server.js#L442)

- readBody 增加大小限制 + error 处理
  [`server.js:330`](../../server.js#L330)

**前端弹幕核心**

- 弹幕模块全貌：昵称、API 调用、队列管理、飘屏动画
  [`danmaku.js:1`](../../public/js/danmaku.js#L1)

- 双重 cleanup 防护（`cleaned` flag）+ isHistory 保留在队列中
  [`danmaku.js:92`](../../public/js/danmaku.js#L92)

- SSE danmaku 事件监听 + 历史加载
  [`api.js:14`](../../public/js/api.js#L14)

**UI 与样式**

- 弹幕 HTML 结构：飘屏层 + 输入栏 + emoji 选择器
  [`index.html:61`](../../public/index.html#L61)

- CSS 飘屏动画 + 输入栏样式
  [`style.css:762`](../../public/style.css#L762)

- 弹幕 UI 初始化 + 事件绑定 + 发送逻辑
  [`main.js:92`](../../public/js/main.js#L92)
