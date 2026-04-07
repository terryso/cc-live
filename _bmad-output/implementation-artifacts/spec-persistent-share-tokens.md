---
title: 'Persistent share tokens across server restarts'
type: 'feature'
created: '2026-04-08'
status: 'done'
baseline_commit: '69f29c7'
context:
  - '_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** shareTokens 存储在内存 Map 中（server.js:38），服务器重启后所有已分享的 URL 立即失效，外部观众无法继续访问。

**Approach:** 将 share tokens 持久化到 JSON 文件，启动时加载，每次增删时写入，使 token 在重启后依然有效直到主动 revoke。

## Boundaries & Constraints

**Always:**
- 使用 Node.js 内置 `fs/promises` 读写 JSON 文件，零外部依赖
- 写入失败不应阻塞服务（静默处理，按项目错误处理风格）
- 持久化文件路径使用与 server.js 同级的 `data/` 目录

**Ask First:** 无（方案直接明确）

**Never:**
- 不加密 token 文件（本地开发工具，安全性由网络层保障）
- 不加 TTL/过期机制（本需求不含此功能）

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 启动加载 | data/share-tokens.json 存在且合法 | shareTokens Map 填充文件内容 | 空 catch，使用空 Map |
| 启动无文件 | data/ 目录不存在或文件不存在 | shareTokens 为空 Map，正常运行 | 自动创建目录和文件 |
| 创建 share | POST /api/shares | 写入 Map + 写入 JSON 文件 | 写入失败仅 console.error，不阻塞响应 |
| 删除 share | DELETE /api/shares/:token | 从 Map 删除 + 写入 JSON 文件 | 写入失败仅 console.error |
| 文件损坏 | JSON.parse 失败 | shareTokens 为空 Map | console.warn + 使用空 Map |

</frozen-after-approval>

## Code Map

- `server.js` -- shareTokens Map 定义（:38）、generateToken()（:71）、resolveToken()（:75）、CRUD 路由（:304-355）
- `lib.js` -- 纯函数库（无相关改动，持久化逻辑放在 server.js）
- `data/share-tokens.json` -- 新增：token 持久化文件

## Tasks & Acceptance

**Execution:**
- [x] `server.js` -- 添加 `saveShareTokens()` 函数，将 shareTokens Map 序列化写入 `data/share-tokens.json` -- 持久化核心
- [x] `server.js` -- 在 create share 和 delete share 路由中调用 `saveShareTokens()` -- 增删时持久化
- [x] `server.js` -- 在 startup 阶段添加 `loadShareTokens()` 从文件加载到 shareTokens Map -- 启动恢复

**Acceptance Criteria:**
- Given 已创建 share token, when 重启服务器, then token 仍然有效，外部观众可继续访问
- Given 已创建 share token, when 调用 DELETE /api/shares/:token, then token 从文件中删除，重启后也不再存在
- Given 无持久化文件, when 服务器启动, then 正常运行，shareTokens 为空

## Spec Change Log

- **Review loop 1:** Adversarial review found race condition in concurrent `saveShareTokens()` calls, startup ordering (`loadShareTokens` after `server.listen`), missing data validation on load, and missing `console.warn` for corrupt JSON. Fixed all: added write queue serialization, moved load before listen, added schema validation for loaded entries, added `console.warn` for SyntaxError. Deferred: atomic write-to-temp-then-rename, redundant mkdir.

## Verification

**Commands:**
- `npm test` -- expected: 现有测试全部通过（无新增测试，持久化逻辑涉及文件 I/O 属于 server.js 副作用）

**Manual checks:**
- 启动服务器，创建 share token，重启服务器，用相同 token URL 访问应成功
- 创建 share token，revoke，重启服务器，该 token URL 应返回 invalid token

## Suggested Review Order

**Persistence layer — load & save with write queue**

- 入口：启动时在 server.listen 之前加载 tokens
  [`server.js:494`](../../server.js#L494)

- 加载函数：从 JSON 文件恢复 tokens，含数据验证和损坏提示
  [`server.js:73`](../../server.js#L73)

- 保存函数：带写入队列的序列化持久化，防止并发竞态
  [`server.js:87`](../../server.js#L87)

**CRUD 调用点**

- 创建 share 后触发持久化
  [`server.js:367`](../../server.js#L367)

- 删除 share 后触发持久化
  [`server.js:383`](../../server.js#L383)
