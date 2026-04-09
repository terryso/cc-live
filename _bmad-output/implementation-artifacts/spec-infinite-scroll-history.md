---
title: '滚动到顶部自动加载历史消息'
type: 'feature'
created: '2026-04-09'
status: 'done'
baseline_commit: '739a314'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 查看历史消息时需要手动点击 "Load more..." 按钮，交互体验割裂，与现代聊天的无限滚动习惯不符。

**Approach:** 移除 "Load more..." 按钮，改为监听滚动位置——当用户滚到顶部时自动触发 `loadMessages()` 加载更早的消息，同时显示加载中指示器。

## Boundaries & Constraints

**Always:**
- 加载完成后保持用户的视觉滚动位置不变（现有的 `prevHeight` 逻辑已支持）
- 加载期间显示轻量级加载指示器（如 "Loading..." 文字或旋转图标）
- 防止并发请求：加载中时忽略重复触发

**Ask First:**
- 加载指示器的具体样式（文字 vs 图标 vs 骨架屏）

**Never:**
- 不改变消息分页大小（保持 50 条）
- 不改变 API 接口
- 不影响筛选（filter）相关的自动加载逻辑

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 滚到顶部有更多消息 | `scrollTop < 阈值`，`hasMoreHistory=true`，未在加载中 | 自动触发 loadMessages，显示加载指示器 | N/A |
| 滚到顶部无更多消息 | `hasMoreHistory=false` | 不触发加载，不显示指示器 | N/A |
| 加载中再次滚到顶部 | 正在加载中 | 忽略，不重复请求 | N/A |
| 筛选模式下的自动加载 | `activeFilter !== 'all'`，当前批次无匹配 | 继续自动加载直到找到匹配或耗尽 | N/A |
| 加载失败 | fetch 抛错 | 静默失败（现有行为），下次滚到顶部可重试 | 捕获异常，重置加载状态 |

</frozen-after-approval>

## Code Map

- `public/js/api.js` (L89-129) -- loadMessages 函数，含 "Load more..." 按钮创建逻辑，需移除按钮、添加加载状态管理
- `public/js/main.js` (L73-79) -- scroll 事件监听器，需添加顶部检测触发加载
- `public/js/state.js` (L7, L28-29) -- `hasMoreHistory` 状态、`loadMessages` 回调引用
- `public/style.css` (L541-553) -- `.load-more-btn` 样式，需替换为加载指示器样式

## Tasks & Acceptance

**Execution:**
- [x] `public/js/state.js` -- 新增 `isLoadingHistory` 布尔状态及其 getter/setter -- 防止并发加载
- [x] `public/js/api.js` -- 移除 "Load more..." 按钮创建代码，改为在顶部插入加载指示器 DOM；加载前设置 `isLoadingHistory=true`，完成后重置为 `false` 并移除指示器 -- 无限滚动核心逻辑
- [x] `public/js/main.js` -- 在 scroll 事件监听中增加顶部检测：当 `scrollTop < 60` 且 `hasMoreHistory && !isLoadingHistory` 时调用 `loadMessages()` -- 自动触发加载
- [x] `public/style.css` -- 将 `.load-more-btn` 样式替换为 `.loading-indicator` 样式（居中文字 + 淡入动画） -- 加载状态视觉反馈

**Acceptance Criteria:**
- Given 消息列表有历史消息可加载，when 用户滚到顶部，then 自动触发加载并显示加载指示器
- Given 正在加载历史消息，when 用户再次滚到顶部，then 不触发重复请求
- Given 所有历史消息已加载完毕（`hasMoreHistory=false`），when 用户滚到顶部，then 不显示加载指示器也不触发请求
- Given 加载完成新消息后，when 观察滚动位置，then 视觉位置保持不变（不跳动）

## Spec Change Log

（空）

## Verification

**Commands:**
- `node test.js` -- expected: all tests pass

**Manual checks:**
- 在浏览器中打开应用，滚动到顶部验证自动加载行为
- 确认加载过程中有视觉指示器
- 确认加载完成后滚动位置不跳动
- 确认不再显示 "Load more..." 按钮

## Suggested Review Order

- 加载状态变量和防并发 guard
  [`state.js:8`](../../public/js/state.js#L8)

- 核心无限滚动逻辑：移除按钮、添加加载指示器、状态管理
  [`api.js:85`](../../public/js/api.js#L85)

- catch 块：错误时清理加载指示器并重置状态
  [`api.js:135`](../../public/js/api.js#L135)

- 项目切换时重置 isLoadingHistory 防止状态残留
  [`render.js:326`](../../public/js/render.js#L326)

- scroll 事件监听：顶部检测触发自动加载
  [`main.js:79`](../../public/js/main.js#L79)

- 加载指示器样式替换原按钮样式
  [`style.css:541`](../../public/style.css#L541)
