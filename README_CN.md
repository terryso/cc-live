# CC Live

<div>

[![Node Version](https://img.shields.io/node/v-literally/22?style=flat-square&color=brightgreen&label=node%20%3E%3D)](https://nodejs.org/)
[![GitHub Repo stars](https://img.shields.io/github/stars/terryso/cc-live?style=flat-square)](https://github.com/terryso/cc-live)
[![GitHub Issues](https://img.shields.io/github/issues/terryso/cc-live?style=flat-square)](https://github.com/terryso/cc-live/issues)
[![BMAD](https://bmad-badge.vercel.app/terryso/cc-live.svg)](https://github.com/bmad-code-org/BMAD-METHOD)
[![GitHub License](https://img.shields.io/github/license/terryso/cc-live?style=flat-square)](https://github.com/terryso/cc-live/blob/main/LICENSE)

</div>

[English](README.md)

Claude Code 会话的实时查看器。实时观看 AI 编码过程，通过 URL 分享给任何人。

**零依赖** — 单文件 Node.js 服务器，无需安装。

> **⚠️ 警告：目前未过滤敏感信息！** 对话内容将原样分享 — API 密钥、密码、Token 等敏感信息对任何持有分享链接的人可见。**分享前请务必检查会话内容。** 敏感信息过滤功能将在下个版本中添加。

## 功能

- 自动发现 `~/.claude/projects/` 下的所有 Claude Code 项目
- 通过 SSE 实时推送 — 消息即时呈现
- 按项目分组查看，支持分页和滚动导航
- 通过 Token 保护的 URL 分享单个项目
- 展示用户消息、助手回复、思考过程、工具调用及结果
- 暗色主题，等宽字体，移动端适配

## 快速开始

```bash
# 启动服务
node server.js

# 浏览器打开
open http://localhost:3456
```

无需其他操作 — 所有 Claude Code 会话自动出现在侧边栏，按项目分组。

## 外网分享

### 方式一：ngrok

```bash
# 安装 ngrok（如未安装）
# brew install ngrok

# 创建公网地址
ngrok http 3456
```

在 `.env` 中设置公网地址，使分享链接使用正确的域名：

```
CC_LIVE_PUBLIC_URL=https://your-subdomain.ngrok-free.dev
```

### 方式二：Cloudflare Tunnel

```bash
# 安装 cloudflared（如未安装）
# brew install cloudflared

# 创建公网地址
cloudflared tunnel --url http://localhost:3456
```

在 `.env` 中设置公网地址：

```
CC_LIVE_PUBLIC_URL=https://your-subdomain.trycloudflare.com
```

### 创建分享链接

1. 点击侧边栏中任意项目旁的 **Share** 按钮
2. 复制生成的 URL — 包含随机 Token，不暴露项目名
3. 随时可在侧边栏底部的 **Active Shares** 面板中撤销

Share Token 仅存储在内存中，重启服务后所有 Token 自动失效。

## 配置

环境变量（可在 `.env` 文件或命令行中设置）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CC_LIVE_PORT` | `3456` | 服务端口 |
| `CLAUDE_DIR` | `~/.claude` | Claude 配置目录 |
| `CC_LIVE_PUBLIC_URL` | — | 公网隧道地址，用于生成分享链接 |

## 工作原理

1. 扫描 `~/.claude/projects/` 下的 JSONL 会话文件（最多 50 个项目，7 天内）
2. 加载每个会话最近 200 条消息作为历史记录，然后持续追踪新内容
3. 解析消息并通过 SSE 实时推送到浏览器
4. 每 10 秒重新扫描新会话

## 限制

- 只读 — 观看者无法与正在进行的会话交互
- 会话数据仅存于内存（每个会话最多 500 条，超出后裁剪至 300 条）
- 服务重启后 Share Token 丢失

## 许可证

MIT
