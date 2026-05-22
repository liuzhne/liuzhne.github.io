---
title: 'MCP 协议为什么抛弃 SSE，转而采用 Streamable HTTP？'
description: '系统梳理 SSE、WebSocket 的底层原理，并解析 MCP 协议从传统 HTTP + SSE 转向 Streamable HTTP 的设计动因。'
pubDate: 2026-05-22
tags: ['MCP', 'SSE', 'WebSocket', 'HTTP', '云原生']
author: 'liuzhne'
draft: false
---

传输层的选择直接决定系统的可扩展性、运维成本与生产可用性。本文系统梳理 SSE、WebSocket 的底层原理，并深入解析 MCP 协议从传统 HTTP + SSE 转向 Streamable HTTP 的设计动因。

## 一、SSE 是什么？

**SSE（Server-Sent Events，服务器推送事件）** 是 HTML5 标准中的一项技术，用于实现服务器向客户端的**单向实时推送**。

### 核心特点

- 基于 HTTP 长连接
- 响应类型为 `text/event-stream`
- 浏览器原生支持（`EventSource` API），无需额外库

### 底层工作原理

1. 客户端发起 `GET` 请求，携带 `Accept: text/event-stream`
2. 服务器返回 `200 OK`，并**保持连接不关闭**
3. 服务器以特定文本格式持续推送数据：

```text
event: message
data: 这是一条消息内容

id: 123
event: update
data: {"key": "value"}
```

SSE 的本质是让 HTTP 响应持续 append 数据，利用**分块传输（Chunked Transfer Encoding）** 实现流式推送，浏览器自动解析事件流。

### 优缺点小结

| 维度 | 评价 |
| --- | --- |
| 实现复杂度 | 低，原生支持，调试友好 |
| 断线重连 | 自动重连，内置 `Last-Event-ID` 机制 |
| 通信方向 | **单向**（服务器 → 客户端），客户端无法推送 |
| 运维成本 | 长连接对 Serverless、负载均衡不友好 |

## 二、WebSocket 又是什么？

WebSocket 是一种在**单个 TCP 连接上进行全双工实时通信**的协议。

### 工作流程

1. 客户端通过 HTTP 握手升级协议（`Upgrade: websocket`）
2. 服务端返回 `101 Switching Protocols`，连接升级成功
3. 双方可随时互发文本、二进制数据，支持 Ping/Pong 心跳保活

### SSE vs WebSocket 对比

| 特性 | SSE | WebSocket |
| --- | --- | --- |
| 通信方向 | 单向（服务器 → 客户端） | 双向（全双工） |
| 协议基础 | HTTP | TCP（HTTP 升级） |
| 实现复杂度 | 低 | 中 |
| 典型场景 | 流式输出、通知推送 | 聊天、实时协作、游戏 |

## 三、MCP 早期方案：HTTP + SSE 双连接架构

早期 MCP 采用 **HTTP POST + 独立 SSE 端点** 的双连接架构：

- 客户端通过 `POST` 发送请求
- 服务端通过独立的 SSE 端点持续推送响应

这种方案在快速验证阶段可行，但随着协议走向生产环境，问题逐渐暴露。

### 痛点一览

- **架构复杂**：需要同时维护两条连接，客户端和服务端的状态管理成本翻倍
- **Serverless 支持差**：长连接在 AWS Lambda、Vercel 等平台上极易超时断连
- **负载均衡困难**：两条连接必须落在同一节点，需要 Sticky Session，破坏水平扩展能力
- **安全策略复杂**：两个端点意味着两套认证、限流、WAF 规则

## 四、Streamable HTTP：MCP 的新一代传输方案

从 2025 年起，MCP 正式推荐 **Streamable HTTP** 作为主要传输方式。

### 核心设计

```text
单一端点 /mcp
    ├── 普通交互  → 标准 HTTP POST + JSON 响应（短连接）
    └── 流式输出  → HTTP POST + text/event-stream 响应（SSE 格式）
```

会话管理通过请求头 `MCP-Session-Id` 实现，无需维护持久连接。

### 设计哲学

> **逻辑上像长连接一样持续对话，物理上采用标准 HTTP 请求**。

Streamable HTTP 并非发明新协议，而是一种**封装策略**：

```text
Streamable HTTP = 标准 HTTP（外壳）
               + SSE（可选流式引擎）
               + MCP-Session-Id（会话管理）
```

它巧妙地保留了 SSE 优秀的流式推送能力，同时将连接生命周期的控制权交还给标准 HTTP 基础设施。

## 五、Streamable HTTP 的运维优势

### 完美适配现代云基础设施

| 场景 | 旧方案（HTTP + SSE） | Streamable HTTP |
| --- | --- | --- |
| Serverless（Lambda/Vercel） | ❌ 长连接超时 | ✅ 每次请求独立 |
| Kubernetes + HPA 水平扩展 | ❌ 需要 Sticky Session | ✅ 无状态，随意扩缩 |
| AWS ALB / Nginx 负载均衡 | ❌ 需特殊配置 | ✅ 开箱即用 |
| WAF / 监控 / 日志链路 | ❌ 两套规则 | ✅ 统一 HTTP 工具链 |

### 资源利用率提升

- 无流式需求时走短连接，**不占用长连接资源**
- 闲置成本更低，突发流量更易承载
- 与现有 APM、链路追踪工具无缝集成

## 六、总结

MCP 协议从传统 HTTP + SSE 转向 Streamable HTTP，是协议从「快速验证」走向「生产就绪」的必然进化。

核心取舍：

- ✅ 保留了 SSE 流式推送的实时体验
- ✅ 借助 HTTP 生态的成熟性大幅降低运维复杂度
- ✅ 单端点设计简化了认证、限流、监控链路
- ✅ 天然适配 Serverless 和云原生基础设施

**对开发者的建议**：新项目直接使用 Streamable HTTP；仅在需要兼容旧客户端时，保留传统 SSE 端点作为降级选项。

## 参考资料

- [MCP 官方协议规范](https://modelcontextprotocol.io)
- [HTTP Chunked Transfer Encoding — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Transfer-Encoding)
- [Server-Sent Events 规范 — WHATWG](https://html.spec.whatwg.org/multipage/server-sent-events.html)
