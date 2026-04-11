---
title: 'Share link password protection'
type: 'feature'
created: '2026-04-11'
status: 'done'
baseline_commit: '7c83427'
context:
  - '_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 分享链接任何人拿到 URL 即可访问会话内容，无二次验证，存在信息泄露风险。

**Approach:** 为 share token 增加可选密码保护。创建分享时弹窗中可设置密码（默认随机生成短密码），访问者需输入正确密码后才能查看内容，验证通过后通过 cookie 记住权限，后续访问无需重复输入。

## Boundaries & Constraints

**Always:**
- 密码存储使用 SHA-256 哈希，服务端不存明文
- 密码验证通过后设置 HttpOnly cookie，包含 token+密码哈希的签名
- 本地访问（localhost）不受密码限制
- 零外部依赖，使用 Node.js 内置 `crypto` 模块

**Ask First:** 无

**Never:**
- 不做密码强度校验（短密码即可，由分享者自行决定）
- 不做密码修改功能（需修改密码则 revoke 后重新创建）
- 不做"忘记密码"或密码重置流程
- 不加密会话内容本身，密码仅控制访问门控

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 创建分享（有密码） | POST /api/shares + password 字段 | token 关联密码哈希，持久化 | 空 password 视为无密码保护 |
| 创建分享（默认） | POST /api/shares 无 password | 生成随机 6 位密码并返回 | N/A |
| 访问有密码的分享 | GET /?t=token，无 cookie | 显示密码输入页面 | N/A |
| 输入正确密码 | POST /api/shares/:token/auth + password | 设置 cookie，返回成功 | N/A |
| 输入错误密码 | POST /api/shares/:token/auth + wrong | 返回 401，提示密码错误 | N/A |
| 带有效 cookie 访问 | GET /?t=token + 有效 cookie | 直接显示内容 | N/A |
| 无密码的分享 | GET /?t=token（token 无密码） | 直接显示内容，跳过密码页 | N/A |
| Cookie 被篡改 | GET /?t=token + 无效 cookie | 视为未验证，显示密码页 | 静默失败 |

</frozen-after-approval>

## Code Map

- `server.js` -- shareTokens Map（:38）、generateToken（:400）、saveShareTokens/loadShareTokens（:73-106）、SSE/消息路由、新增 auth 端点
- `public/index.html` -- 分享弹窗 UI、新增密码输入页面
- `public/state.js` -- isShareView 状态、需新增 isPasswordVerified 状态
- `public/api.js` -- share 请求逻辑、需新增密码验证请求

## Tasks & Acceptance

**Execution:**
- [x] `server.js` -- shareTokens Map 结构扩展为 `{ project, createdAt, passwordHash }`；saveShareTokens/loadShareTokens 适配新字段（向后兼容旧无密码 token）
- [x] `server.js` -- POST /api/shares 接受 password 参数，为空时自动生成 6 位随机密码；响应中返回明文密码（仅创建时返回一次）
- [x] `server.js` -- 新增 POST /api/shares/:token/auth 端点，验证密码后设置 HttpOnly cookie（包含 token+密码哈希的 HMAC 签名）
- [x] `server.js` -- 所有 share token 相关路由（SSE、消息、弹幕等）增加密码验证中间逻辑：有 passwordHash 的 token 必须携带有效 cookie 才能访问
- [x] `public/index.html` -- 分享弹窗增加密码输入框，预填充随机密码，显示/隐藏切换
- [x] `public/index.html` -- 新增密码输入页面（全屏覆盖），包含密码输入框和提交按钮，样式与现有深色主题一致
- [x] `public/js/api.js` -- 创建分享时发送密码；检测到需要密码验证时显示密码页；验证成功后加载正常内容

**Acceptance Criteria:**
- Given 创建分享时未指定密码, when 分享创建完成, then 自动生成 6 位随机密码并在弹窗中显示
- Given 分享设有密码, when 访问者打开分享链接, then 显示密码输入页面而非会话内容
- Given 访问者输入正确密码, when 验证通过, then 设置 cookie 并加载会话内容
- Given 访问者已通过密码验证, when 再次打开相同分享链接, then 直接显示内容无需重新输入密码
- Given 分享未设密码, when 访问者打开分享链接, then 直接显示内容，跳过密码步骤
- Given 本地 localhost 访问, when 浏览服务, then 不受任何密码限制

## Spec Change Log

- **Review loop 1:** Adversarial review found 4 issues. Fixed: HMAC comparison switched to `timingSafeEqual` to prevent timing attacks; `getCookie` regex name escaped for defensive programming; `/auth` endpoint returns generic error for both missing token and wrong password to prevent token existence oracle; SSE connection closed immediately after `password-required` event to prevent resource leak. Deferred: cookie secret persistence across restarts, rate limiting on auth endpoint.

## Verification

**Manual checks:**
- 启动服务器，创建带密码的分享，从另一浏览器访问应显示密码页
- 输入正确密码后应能看到内容，刷新页面无需重新输入
- 输入错误密码应提示错误，不能看到内容
- 服务器重启后，密码保护依然生效
- 旧的（无密码的）分享 token 仍然正常工作

## Suggested Review Order

**Password hashing & cookie signing**

- 密码哈希、密码生成、HMAC 签名、cookie 验证核心工具函数
  [`server.js:109`](../../server.js#L109)

- 时序安全比较防止 timing attack，regex 转义防止注入
  [`server.js:135`](../../server.js#L135)

**Share creation with password**

- 创建分享时接受密码参数，默认自动生成 6 位随机密码
  [`server.js:445`](../../server.js#L445)

**Authentication endpoint**

- 密码验证端点，统一错误响应防止 token 存在性泄露
  [`server.js:474`](../../server.js#L474)

**Auth gate for share routes**

- 全局密码拦截门控，保护所有 API 路由
  [`server.js:402`](../../server.js#L402)

- SSE 端点的密码检查，发送 password-required 后立即关闭连接
  [`server.js:599`](../../server.js#L599)

**Frontend password gate UI**

- 密码输入页面 HTML 覆盖层
  [`index.html:82`](../../public/index.html#L82)

- SSE password-required 事件监听 → 显示密码页
  [`api.js:70`](../../public/js/api.js#L70)

- 分享创建弹窗：密码输入 + 结果展示
  [`api.js:173`](../../public/js/api.js#L173)

- 密码验证提交 + 成功后 reload
  [`api.js:241`](../../public/js/api.js#L241)

**Backward compatibility**

- 旧 token 无密码时 passwordHash 默认 null，向后兼容
  [`lib.js:106`](../../lib.js#L106)

