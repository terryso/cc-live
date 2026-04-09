---
title: '用户命令和技能消息格式化渲染'
type: 'feature'
created: '2026-04-09'
status: 'in-review'
baseline_commit: '17bf2fb'
spec_file: '_bmad-output/implementation-artifacts/spec-command-skill-rendering.md'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 用户消息中，斜杠命令（如 `/bmad-quick-dev`）显示为原始 XML 标签，技能调用消息（以 "Base directory for this skill:" 开头）显示为原始 Markdown 文本，可读性差。

**Approach:** 参考 claude-history 项目的 `process_command_message()` 方案，在 `lib.js` 的 `extractDisplayMessage` 中解析这两类消息，提取关键信息生成结构化 display 对象；在 `index.html` 中新增对应的渲染函数，以简洁美观的方式展示。

## Boundaries & Constraints

**Always:** 保留现有的消息过滤逻辑（`<local-command-caveat>`、`<local-command-stdout>` 空内容等仍被过滤）；保持与现有 `msgContent()` 渲染管线兼容。

**Ask First:** 如果发现 JSONL 中存在其他未处理的 XML 标签格式，需要确认处理方式。

**Never:** 不要修改 assistant 消息的渲染逻辑；不要移除已有的 tool_result 处理；不要引入新的外部依赖。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 斜杠命令 | `<command-message>bmad-help</command-message><command-name>/bmad-help</command-name><command-args>分析状态</command-args>` | 显示为格式化的命令气泡：`/bmad-help 分析状态` | 缺少 args 时只显示命令名 |
| 技能调用 | `Base directory for this skill: /path\n# Skill Title\n## Purpose\n...` | 显示为技能摘要：图标 + 技能标题 + 参数预览 | 无法提取标题时显示 "Skill invoked" |
| /clear 命令 | `<command-name>/clear</command-name>` | 过滤不显示（上下文清理命令） | N/A |
| 混合内容 | 同时包含图片引用和文本的用户消息 | 保持现有渲染不变 | N/A |

</frozen-after-approval>

## Code Map

- `lib.js:116-167` -- `extractDisplayMessage()` 核心消息解析入口，需增加命令/技能消息识别分支
- `lib.js:123-150` -- user 类型消息处理逻辑，需在此添加新的内容检测
- `public/index.html:1255-1273` -- `msgContent()` 消息渲染分发，需增加新 display type 的渲染
- `public/index.html:912-916` -- `renderMd()` Markdown 渲染函数，技能消息可复用

## Tasks & Acceptance

**Execution:**
- [x] `lib.js` -- 在 `extractDisplayMessage()` 的 user 分支中，增加命令消息解析（`<command-message>`/`<command-name>`）和技能消息解析（"Base directory for this skill:"），生成新的 display type `command` 和 `skill` -- 将原始 XML/文本转为结构化数据
- [x] `public/index.html` -- 新增 `renderCommand(p)` 和 `renderSkill(p)` 渲染函数，在 `msgContent()` 中添加对应分支 -- 以简洁美观的 UI 展示命令和技能信息
- [x] `public/index.html` -- 添加命令/技能消息的 CSS 样式，区分于普通用户消息 -- 视觉一致性

**Acceptance Criteria:**
- Given 用户消息包含 `<command-name>/bmad-help</command-name>` 标签，when 消息被提取渲染，then 显示为格式化的命令气泡（命令名 + 参数），而非原始 XML
- Given 用户消息以 "Base directory for this skill:" 开头，when 消息被提取渲染，then 显示为技能摘要（标题 + 参数预览），而非原始 Markdown 文本
- Given 用户消息包含 `/clear` 命令，when 消息被提取，then 返回 null（不显示）

## Design Notes

参考 claude-history 的 `src/display.rs:process_command_message()` 设计：
- 命令消息：用正则提取 `<command-name>` 和 `<command-args>` 内容，格式化为 `/command args`
- 技能消息：跳过 "Base directory" 行，提取第一个非空行（通常是 `# 标题`）作为描述
- 新增 display type `command`（字段：name, args）和 `skill`（字段：title, args, basePath）

渲染样式建议：
- 命令消息：深色背景 + 等宽字体 + 绿色命令前缀，类似终端风格
- 技能消息：浅色背景 + 工具图标 + 标题高亮

## Verification

**Manual checks:**
- 打开包含 `/bmad-quick-dev` 命令的会话，确认命令消息显示为格式化气泡而非原始 XML
- 打开包含技能调用的会话，确认显示为技能摘要而非原始 Markdown
- 确认普通用户文本消息渲染不受影响
