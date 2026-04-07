---
title: 'Streaming typewriter effect for live demo'
type: 'feature'
created: '2026-04-07'
status: 'ready-for-dev'
context:
  - '_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** cc-watch 的消息是整条出现的，教学场景中学生看不到"逐字生成"的直播感，体验像看日志不像看直播。

**Approach:** 前端收到新的 SSE 消息时，用打字机动画逐字渲染文本内容，而不是一次性显示完整消息。保持现有 JSONL 轮询架构不变，仅在前端增加视觉效果。

## Boundaries & Constraints

**Always:**
- 保持零 npm 依赖、单文件架构
- 仅对 SSE 实时推送的新消息做动画，历史消息加载时直接显示
- 打字速度应接近 AI 真实输出速度（约 30-50ms/字）
- 动画期间保持自动滚动行为（用户在底部时跟随）

**Ask First:**
- 如果需要调整打字速度或添加速度控制 UI

**Never:**
- 不修改后端 JSONL 轮询逻辑
- 不引入 WebSocket 或改变 SSE 架构
- 不对 tool_use、tool_result 做打字动画（这些直接显示）
- 不对 thinking 内容做打字动画（直接显示）

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 新 assistant 消息到达 | SSE message event，role=assistant，含 text block | 文字逐字出现，约 30ms/字符 | N/A |
| 新 user 消息到达 | SSE message event，role=user | 直接显示，不做动画 | N/A |
| 快速连续消息 | 多条消息快速到达 | 排队依次动画，不跳过 | N/A |
| 用户向上浏览 | scrollHeight - scrollTop > 200 | 停止自动滚动，动画继续但不强制跳转 | N/A |
| 加载历史消息 | loadMessages() 返回的消息 | 直接渲染，不做动画 | N/A |
| 页面切换 | 用户切换到另一个 project | 中断当前动画，清空队列 | N/A |

</frozen-after-approval>

## Code Map

- `server.js` (FRONTEND_HTML 内联 JS) -- appendMsg() 函数，createMsgEl() 函数，SSE message 事件监听器

## Tasks & Acceptance

**Execution:**
- [ ] `server.js` -- 在前端 JS 中添加 typewriter 动画引擎：维护动画队列，逐字渲染 text 内容块，30ms/字符，动画期间光标闪烁效果 -- 实现直播视觉体验
- [ ] `server.js` -- 修改 appendMsg() 和 SSE message handler：新消息走 typewriter 队列，区分 text（动画）和其他 block 类型（直接显示） -- 正确区分动画与非动画内容

**Acceptance Criteria:**
- Given SSE 推送一条 assistant text 消息，when 消息到达前端，then 文字逐字出现（约 30ms/字），带闪烁光标效果
- Given 历史消息通过 loadMessages() 加载，when 渲染完成，then 所有消息直接显示，无打字动画
- Given 打字动画进行中，when 用户切换 project，then 动画立即停止并清空队列
- Given tool_use 或 tool_result 消息到达，when 走 appendMsg，then 直接显示不做动画

## Spec Change Log

## Design Notes

**Typewriter 引擎设计：**
- 全局动画队列 `typewriterQueue = []`，全局状态 `isTypewriting = false`
- 每条消息拆分为多个 block，只有 `type === 'text'` 的 block 做动画
- 动画用 `requestAnimationFrame` + `setTimeout(30)` 控制
- 动画中的文本末尾显示 `▋` 光标，动画完成后移除
- `appendMsg()` 改为非同步：创建 DOM 元素后，将 text block 的动画任务推入队列
- 新增 `processQueue()` 函数：顺序处理队列中的动画任务

**金色示例（动画流程）：**
```
SSE message → appendMsg(m) → createMsgEl(m) 但 text block 内容先清空
→ 将 {el, fullText} 推入 typewriterQueue
→ processQueue() 逐字填充: "H▋" → "Hi▋" → "Hi!▋" → "Hi!"
```

## Verification

**Manual checks:**
- 启动 `node server.js`，在浏览器打开，选择一个活跃的 project
- 在 Claude Code 中发送消息，观察 cc-watch 前端是否逐字显示
- 切换 project 后再切回，历史消息应直接显示
- 滚动到顶部，新消息到达时不应强制滚动到底部
