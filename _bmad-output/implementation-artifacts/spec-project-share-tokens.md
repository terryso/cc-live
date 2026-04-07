---
title: 'Project-based session filtering with secure share tokens'
type: 'feature'
created: '2026-04-07'
status: 'done'
baseline_commit: '5f5abc6'
context:
  - '_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 当前 server.js 启动后全局监控最近 20 个会话文件，不区分项目。一个项目开发过程中会有多个会话（清上下文、开新会话），20 个文件限制导致项目会话分散丢失，且无法安全地只分享单个项目的会话给外部观众。

**Approach:** 去掉 20 文件限制，改为按项目加载所有会话。本地访问可看到全部项目；分享时通过生成随机 token 的安全链接，外部观众只能看到 token 映射的单个项目会话，项目名不暴露在 URL 中。

## Boundaries & Constraints

**Always:**
- 零 npm 依赖，仅用 Node.js 内置模块（含 `crypto` 生成 token）
- ES Modules 语法
- SSE 心跳保活机制保持不变
- 前端保持内联 HTML 单文件架构

**Ask First:**
- token 过期策略（如需要过期时间）
- 是否需要管理页面来查看/撤销已有分享

**Never:**
- 不引入任何 npm 包
- 不使用数据库或文件持久化分享 token（内存 Map 即可）
- 不在前端 URL 中暴露真实项目名

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 本地访问无 token | 直接访问 `localhost:3456` | 显示所有项目的所有会话，侧边栏按项目分组 | N/A |
| 创建分享 | `POST /api/shares { project: "cc-watch" }` | 返回 `{ token, url }`，token 为 24 字符随机 hex | 项目不存在返回 404 |
| 分享链接访问 | `GET /?t=abc123...` | 只显示 token 对应项目的会话，隐藏侧边栏项目列表 | 无效 token 显示"无权访问" |
| 分享链接 SSE | `GET /events?t=abc123...` | 只推送该项目的消息事件 | 无效 token 返回 403 |
| 撤销分享 | `DELETE /api/shares/:token` | 从内存删除 token，链接立即失效 | token 不存在返回 404 |
| 无 token 外部访问 | `GET /events`（非 localhost） | 返回空会话列表，不暴露任何数据 | N/A |

</frozen-after-approval>

## Code Map

- `server.js` -- 唯一源文件，包含全部后端逻辑和内联前端 HTML

## Tasks & Acceptance

**Execution:**
- [x] `server.js` -- 去掉 `MAX_WATCHED = 20` 限制，`findRecentSessionFiles` 改为加载所有项目所有会话文件 -- 当前限制导致项目会话丢失
- [x] `server.js` -- 新增 `shareTokens = Map<token, { project, createdAt }>` 状态管理，用 `crypto.randomBytes` 生成 token -- 安全分享核心
- [x] `server.js` -- 新增 API 路由：`POST /api/shares`（创建）、`DELETE /api/shares/:token`（撤销）、`GET /api/shares`（列出已有分享，仅本地） -- 分享生命周期管理
- [x] `server.js` -- 修改 SSE `/events` 端点，支持 `?t=token` 参数，按 token 过滤只推送对应项目消息 -- 分享隔离
- [x] `server.js` -- 修改 API `/api/sessions` 和 `/api/session/:id`，支持 token 过滤 -- API 隔离
- [x] `server.js` -- 前端改造：本地视图按项目分组显示，每个项目旁添加「分享」按钮；分享视图只显示对应项目，隐藏管理功能 -- 前端体验

**Acceptance Criteria:**
- Given 服务器启动监控多个项目, when 本地访问, then 看到所有项目所有会话按项目分组
- Given 已创建分享 token, when 用 `?t=token` 访问, then 只能看到对应项目会话
- Given 无效 token, when 访问分享链接, then 看到无权访问提示且无法获取任何数据
- Given 已撤销 token, when 再次访问分享链接, then 链接立即失效
- Given 分享链接 URL, when 检查, then 不包含任何项目名信息

## Design Notes

Token 生成：`crypto.randomBytes(12).toString('hex')` → 24 字符 hex 字符串，不可预测。

本地 vs 分享判断逻辑：前端通过 URL 是否有 `?t=` 参数区分两种视图模式，不依赖 IP 判断。后端在 SSE/API 层面对 token 做服务端校验，无 token 或无效 token 时不返回敏感数据。

侧边栏分组：项目名作为分组标题，下面列出该项目的所有会话（按消息数排序）。

## Verification

**Commands:**
- `node server.js` -- expected: 启动无报错，console 显示所有项目会话数量
- `curl -X POST http://localhost:3456/api/shares -H 'Content-Type: application/json' -d '{"project":"cc-watch"}'` -- expected: 返回带 token 的 JSON

**Manual checks:**
- 浏览器打开 `localhost:3456` 确认看到所有项目分组
- 点击分享按钮确认生成 token 并显示分享 URL
- 用分享 URL 在无痕窗口打开确认只能看到对应项目

## Suggested Review Order

- 项目过滤 + 时间窗口配置常量
  [`server.js:11`](../../server.js#L11)

- 分享 token 状态管理 + crypto 生成
  [`server.js:17`](../../server.js#L17)

- 按项目分组的广播过滤逻辑
  [`server.js:38`](../../server.js#L38)

- findAllSessionFiles — 按项目聚合，7 天窗口，限 50 项目
  [`server.js:123`](../../server.js#L123)

- 分享 API 路由（创建/列出/撤销）
  [`server.js:244`](../../server.js#L244)

- SSE 端点 token 校验 + 过滤
  [`server.js:286`](../../server.js#L286)

- 前端项目分组渲染 + 分享按钮
  [`server.js:345`](../../server.js#L345)

- 前端分享 modal + 撤销面板
  [`server.js:432`](../../server.js#L432)
