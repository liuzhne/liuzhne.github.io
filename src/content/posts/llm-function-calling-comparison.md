---
title: '三大主流大模型 Function Calling 全解析：OpenAI、Claude、Gemini 对比指南'
description: '系统对比 OpenAI、Claude 与 Gemini 的 Function Calling / Tool Use 机制，梳理调用流程、Schema 约束、并行工具、流式处理与选型建议。'
pubDate: 2026-05-26
tags: ['Function Calling', 'OpenAI', 'Claude', 'Gemini', 'LLM']
author: 'liuzhne'
draft: false
---

> **导读**：Function Calling 已经成为 LLM 接入真实业务系统的基础能力。无论是查询数据库、调用内部 API，还是让 Agent 执行多步骤任务，本质上都绕不开"模型决策、应用执行、结果回传"这一循环。本文基于 OpenAI、Anthropic Claude 与 Google Gemini 的官方文档，系统梳理三家实现的共同模型、关键差异与工程选型思路。

---

## 一、Function Calling 解决了什么问题

大语言模型本身擅长理解自然语言、生成文本和进行推理，但它并不会天然知道实时数据，也不会直接操作你的业务系统。**Function Calling**（函数调用）正是为了解决这个断点：让模型用结构化方式告诉应用"我需要调用哪个函数、参数是什么"，再由应用真正执行函数并把结果交回给模型。

Anthropic Claude 更常把这套能力称为 **Tool Use**，Google Gemini 也使用 Function Calling 这一术语。命名略有差异，但核心价值一致：**把自然语言意图转换成可执行的 API 调用**。

典型场景包括：

- **增强知识**：查询数据库、搜索、知识库、天气、汇率、库存等实时信息。
- **扩展能力**：调用计算器、图表生成、代码执行器、文件处理器等外部工具。
- **执行动作**：创建订单、发送邮件、更新 CRM、预订会议、控制智能设备等。

一句话概括：Function Calling 让 LLM 从"只会说"进一步变成"能接入系统做事"。

---

## 二、三家术语的共同底层模型

不同厂商的字段命名并不完全一致，但开发者需要理解的抽象其实很稳定。

| 概念 | OpenAI | Claude | Gemini |
|------|--------|--------|--------|
| 工具 / 函数定义 | `tools` / `function` | `tools` / `tool` | `tools` / `function_declarations` |
| 模型调用请求 | `tool_call` / `function_call` | `tool_use` block | `functionCall` |
| 执行结果返回 | `tool` role 消息 / `function_call_output` | `tool_result` block | `function_response` |
| 调用 ID | `call_id` / `tool_call_id` | `tool_use_id` | SDK 自动管理为主 |
| 模式控制 | `tool_choice` | `tool_choice` | `function_calling_config.mode` |

这里有三个概念最关键：

- **Tool / Function**：应用暴露给模型的能力定义，例如 `get_weather(location)`。
- **Tool Call**：模型判断需要使用某个工具，并生成结构化参数。
- **Tool Result**：应用执行工具后，把真实结果回传给模型。

需要反复强调的是：**模型不会替你执行函数**。模型只负责生成调用意图和参数；函数执行、权限控制、错误处理、审计记录，都必须由你的应用代码负责。

---

## 三、统一的五步调用循环

三家的实现细节不同，但核心流程可以抽象为一个五步循环：

```text
1. 应用 -> 模型：发送用户提示 + 工具定义
2. 模型 -> 应用：返回结构化工具调用和参数
3. 应用：执行对应函数，拿到真实结果
4. 应用 -> 模型：把函数执行结果回传给模型
5. 模型 -> 应用：基于结果生成最终自然语言回复
```

这也是 Function Calling 的工程边界：模型负责"决策"，应用负责"执行"。只要边界清楚，后面的 Schema 设计、错误处理、安全审批和日志审计就都有了落点。

---

## 四、OpenAI Function Calling

OpenAI 的 Function Calling 是最早被广泛采用的实现之一，在 Chat Completions API 和 Responses API 中都可以使用。

### 4.1 函数定义

OpenAI 使用 `tools` 数组声明函数。一个典型工具定义如下：

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Retrieves current weather for the given location.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "City and country e.g. Bogota, Colombia"
                    },
                    "units": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "Units the temperature will be returned in."
                    }
                },
                "required": ["location", "units"],
                "additionalProperties": False
            },
            "strict": True
        }
    }
]
```

几个字段值得特别关注：

| 字段 | 作用 |
|------|------|
| `name` | 函数名，应该短、清晰、语义稳定 |
| `description` | 告诉模型什么时候使用这个函数 |
| `parameters` | JSON Schema 形式的参数定义 |
| `strict` | 启用严格模式，让参数更稳定地符合 Schema |

### 4.2 标准调用流程

应用先把工具定义和用户消息一起发给模型，模型返回一个或多个工具调用；应用执行后，再把结果作为 `tool` 消息回传。

```python
from openai import OpenAI
import json

client = OpenAI()

messages = [
    {"role": "user", "content": "What is my horoscope? I am an Aquarius."}
]

response = client.chat.completions.create(
    model="gpt-4.1",
    messages=messages,
    tools=tools,
)

messages.append(response.choices[0].message)

for tool_call in response.choices[0].message.tool_calls or []:
    if tool_call.function.name == "get_horoscope":
        args = json.loads(tool_call.function.arguments)
        horoscope = get_horoscope(args["sign"])

        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": json.dumps({"horoscope": horoscope}),
        })

response = client.chat.completions.create(
    model="gpt-4.1",
    messages=messages,
    tools=tools,
)

print(response.choices[0].message.content)
```

示例中的模型名称需要替换为你账号当前可用的版本。真正重要的是消息结构：模型输出工具调用，应用执行工具，再把结果按对应 ID 回传。

### 4.3 OpenAI 的特色能力

OpenAI 的优势主要体现在 Schema 约束和输出控制上：

- **Strict 模式**：`strict: true` 会强制模型生成符合 JSON Schema 的参数。实践中通常要求所有字段进入 `required`，并设置 `additionalProperties: false`。
- **并行函数调用**：模型可以一次返回多个工具调用，可用 `parallel_tool_calls: false` 关闭。
- **Tool Choice 控制**：支持自动选择、强制调用、指定某个函数，或限制在某个工具子集内。
- **Custom Tools**：除了 JSON Schema 函数，还支持文本输入类自定义工具，并可用 CFG、Lark、regex 等方式约束格式。
- **Tool Search**：当工具数量很大时，可以按需加载工具定义，避免一次性把所有 Schema 塞进上下文。
- **流式工具调用**：可增量接收工具参数片段，适合实时 UI 展示工具调用过程。

---

## 五、Claude Tool Use

Claude 把这套能力称为 **Tool Use**，并明确区分 **Client Tools** 与 **Server Tools**。

### 5.1 两类工具执行位置

| 类型 | 执行位置 | 示例 |
|------|----------|------|
| Client Tools | 开发者自己的应用 | 自定义业务函数、bash、text editor、computer、memory 等 |
| Server Tools | Anthropic 基础设施 | web_search、web_fetch、code_execution、tool_search 等 |

Client Tools 与 OpenAI 的调用模式相似：Claude 返回 `tool_use` block，应用执行工具，再通过 `tool_result` block 回传。

Server Tools 则更像平台托管能力：开发者启用工具后，搜索、抓取或代码执行由平台侧完成，结果直接进入模型上下文。

### 5.2 Server Tool 示例

```python
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-7",
    max_tokens=1024,
    tools=[{"type": "web_search_20260209", "name": "web_search"}],
    messages=[{"role": "user", "content": "What's the latest on the Mars rover?"}],
)

print(response.content)
```

这个例子展示的是 Server Tool 的开发体验：应用不需要自己处理 `tool_result`，搜索结果由平台侧完成并纳入模型推理。实际使用时同样需要以账号可用的模型和工具版本为准。

### 5.3 Client Tool 标准流程

对自定义工具来说，Claude 的流程可以拆成五步：

1. 在 `tools` 中声明工具的 `name`、`description` 和 `input_schema`。
2. 模型返回 `stop_reason: "tool_use"`，并在 content 中给出 `tool_use` block。
3. 应用执行对应工具。
4. 应用用 `tool_result` block 回传结果，并通过 `tool_use_id` 关联调用。
5. 模型继续推理，生成最终回复。

### 5.4 Claude 的特色能力

Claude 的差异化更多体现在工具生态和托管工具上：

- **Server Tools 体系**：web_search、web_fetch、code_execution、computer use 等工具可以由平台托管执行。
- **Trained-in Schema 工具**：bash、text_editor、computer、memory 等工具的 Schema 是模型更熟悉的接口，调用稳定性和错误恢复更好。
- **Strict Tool Use**：可启用严格工具使用模式，降低参数偏离 Schema 的概率。
- **Prompt Caching**：工具定义与系统提示可结合缓存，减少多轮调用成本。
- **并行工具调用**：支持一次返回多个工具调用。
- **Programmatic Tool Calling**：适合更可控地编排工具流程。
- **Tool Search**：支持按需检索和加载工具，缓解大工具集的上下文压力。

需要注意的是，启用工具通常会带来额外 token 成本。Claude 会注入工具相关系统提示，服务端工具也可能按调用量额外计费。

---

## 六、Gemini Function Calling

Gemini 的 Function Calling 与前两家在核心模型上高度一致，但 SDK 层面提供了一个很有吸引力的能力：**Automatic Function Calling**。

### 6.1 函数定义

Gemini 使用 OpenAPI Schema 的子集来定义函数参数：

```python
set_light_values_declaration = {
    "name": "set_light_values",
    "description": "Sets the brightness and color temperature of a light.",
    "parameters": {
        "type": "object",
        "properties": {
            "brightness": {
                "type": "integer",
                "description": "Light level from 0 to 100. Zero is off and 100 is full brightness",
            },
            "color_temp": {
                "type": "string",
                "enum": ["daylight", "cool", "warm"],
                "description": "Color temperature of the light fixture.",
            },
        },
        "required": ["brightness", "color_temp"],
    },
}
```

### 6.2 手动调用流程

手动流程同样是"声明工具、模型返回调用、应用执行、回传结果、模型生成最终答复"：

```python
from google import genai
from google.genai import types

client = genai.Client()

tools = types.Tool(function_declarations=[set_light_values_declaration])
config = types.GenerateContentConfig(tools=[tools])

contents = [
    types.Content(
        role="user",
        parts=[types.Part(text="Turn the lights down to a romantic level")],
    )
]

response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=contents,
    config=config,
)

tool_call = response.candidates[0].content.parts[0].function_call

if tool_call.name == "set_light_values":
    result = set_light_values(**tool_call.args)

function_response_part = types.Part.from_function_response(
    name=tool_call.name,
    response={"result": result},
)

contents.append(response.candidates[0].content)
contents.append(types.Content(role="user", parts=[function_response_part]))

final_response = client.models.generate_content(
    model="gemini-2.5-flash",
    config=config,
    contents=contents,
)

print(final_response.text)
```

### 6.3 Automatic Function Calling

Gemini Python SDK 的亮点，是可以直接把 Python 函数传给 `tools`。SDK 会根据类型提示和 docstring 生成 Schema，检测模型函数调用，执行函数，并把结果回传给模型。

```python
def get_current_temperature(location: str) -> dict:
    """Gets the current temperature for a given location.

    Args:
        location: The city and state, e.g. San Francisco, CA

    Returns:
        A dictionary containing the temperature and unit.
    """
    return {"temperature": 25, "unit": "Celsius"}

config = types.GenerateContentConfig(tools=[get_current_temperature])

response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="What's the temperature in Boston?",
    config=config,
)

print(response.text)
```

对于原型验证和内部工具，Automatic Function Calling 能显著减少样板代码。不过在生产系统里，仍然建议保留权限控制、错误处理、审计日志和高风险操作审批。

### 6.4 Gemini 的特色能力

- **Automatic Function Calling**：Python SDK 可以自动完成函数 Schema 转换、执行和结果回传。
- **Compositional Function Calling**：可串联多个函数调用完成复合任务。
- **Function Calling Modes**：通过 `AUTO`、`ANY`、`NONE` 控制是否调用函数，以及是否强制调用。
- **Thought Signatures**：启用 thinking 时，内部推理上下文会通过加密签名在多轮中保持连续。
- **MCP 原生支持**：Python 和 JavaScript SDK 可把 MCP `ClientSession` 作为工具接入。
- **Multi-tool Use**：可同时使用搜索、代码执行和自定义函数。

---

## 七、进阶能力横向对比

### 7.1 并行调用

| 厂商 | 并行支持 | 控制方式 |
|------|----------|----------|
| OpenAI | 默认支持 | `parallel_tool_calls: false` 可关闭 |
| Claude | 支持 | 使用 Parallel Tool Use 相关配置和提示 |
| Gemini | 支持 | 2.5 系列可配合 `mode='ANY'` 使用 |

工程上不要假设模型只会返回一个调用。即使你的业务当前只有一个工具，也应该把响应处理写成数组循环。

### 7.2 严格模式与 Schema 约束

| 厂商 | 约束方式 | 备注 |
|------|----------|------|
| OpenAI | `strict: true` | 基于 Structured Outputs，要求 Schema 写法更严格 |
| Claude | `strict: true` | 目标同样是降低参数偏离 |
| Gemini | OpenAPI Schema 子集 | 主要通过类型、required、enum 等约束 |

Schema 设计越清晰，模型越容易选对工具、填对参数。不要把一个"万能工具"暴露给模型，也不要让多个工具语义重叠。

### 7.3 流式工具调用

三家都支持工具调用的流式输出，但事件结构不同：

- **OpenAI**：`tool_calls` 会通过 `delta` 增量返回，应用需要按 `index` 聚合参数片段；Responses API 中也有专门的 function call arguments delta 事件。
- **Claude**：支持 fine-grained tool streaming，可以更早拿到工具参数片段。
- **Gemini**：新版本支持流式函数调用参数输出，适合把工具调用过程展示在 UI 中。

### 7.4 工具搜索与延迟加载

当工具数量超过 20 个后，一次性塞进上下文会带来两个问题：token 成本上升，以及模型更容易选错工具。

| 厂商 | 大规模工具管理 |
|------|----------------|
| OpenAI | `tool_search`、namespace、defer loading |
| Claude | `tool_search` 按需加载 |
| Gemini | 更强调手动控制活跃工具数量 |

通用建议是：让模型每次只看到当前任务真正可能用到的工具。工具越少、职责越清晰，Function Calling 越稳定。

---

## 八、工程最佳实践

综合三家文档，下面这些原则最值得优先落地。

### 8.1 工具定义要像 API 文档一样清楚

函数名、参数名和描述要让模型一眼看懂：

- 函数名表达动作和对象，例如 `get_order_status`。
- 参数描述写清格式、单位、取值范围和示例。
- 用 `enum`、对象结构和 `required` 减少非法状态。
- 在系统提示中说明什么时候用、什么时候不用。

可以用一个简单的"实习生测试"来检查：一个不了解系统的新同事，只看这些工具描述，能不能正确调用？

### 8.2 能用代码确定的参数，不要让模型猜

如果 `order_id`、`user_id`、`tenant_id` 已经在会话或请求上下文里，就不要让模型重新生成。由应用代码注入这些确定参数，比让模型复述更安全。

同理，如果两个函数总是连续调用，可以考虑合并成一个更贴近业务语义的工具。

### 8.3 默认处理多个工具调用

模型一次响应可能返回零个、一个或多个工具调用。生产代码应该始终按数组处理，并考虑并行执行、顺序依赖和失败回滚。

### 8.4 错误信息要可恢复

工具失败时，不要只返回 `"error"`。更好的方式是返回结构化错误：

```json
{
  "error_code": "ORDER_NOT_FOUND",
  "message": "No order found for the given order_id.",
  "retryable": false
}
```

这样模型才有机会决定是重试、换参数，还是向用户说明问题。

### 8.5 高风险操作必须有人类确认

发邮件、下单、退款、删除数据、发布公告等操作，都不应该在模型一次工具调用后直接执行。更稳妥的做法是：

1. 模型生成计划和参数。
2. 应用展示给用户确认。
3. 用户确认后再执行工具。
4. 执行结果进入日志和审计链路。

### 8.6 控制 temperature 和工具数量

Function Calling 场景通常追求稳定性，建议使用较低 temperature。工具定义也会占用输入 token，初始可见工具数量最好控制在 10-20 个以内；更大的工具集应该通过路由、检索或动态加载来管理。

### 8.7 安全边界放在应用层

不要把安全完全交给模型。应用层至少要负责：

- 鉴权与权限范围控制。
- 参数白名单、长度限制和 Schema 校验。
- 高风险工具审批。
- 敏感数据脱敏。
- 工具调用日志与异常监控。
- computer use 等高权限工具的隔离运行环境。

---

## 九、选型建议

三家 Function Calling 的核心范式已经高度统一，差异主要体现在生态和开发体验上。

| 维度 | OpenAI | Claude | Gemini |
|------|--------|--------|--------|
| 基础函数调用 | 成熟 | 成熟 | 成熟 |
| 严格 Schema | `strict` + Structured Outputs | `strict` | OpenAPI Schema 子集 |
| 并行调用 | 支持 | 支持 | 支持 |
| 平台托管工具 | web_search 等内置工具 | Server Tools 体系突出 | Search、Code Execution 等原生工具 |
| 大规模工具管理 | tool_search + namespace | tool_search | 手动控制活跃工具 |
| 自动函数调用 | 以手动循环为主 | 以手动循环为主 | Python SDK 自动闭环 |
| 自定义文法约束 | Lark / regex CFG | 相对较少 | 相对较少 |
| MCP 支持 | 支持 | 支持连接器 | SDK 内置支持 |

可以按以下思路选择：

- **偏严格输出和复杂 Schema 控制**：OpenAI 的 strict mode、Structured Outputs、Responses API 和自定义 CFG 更适合需要强约束的系统。
- **偏平台托管工具和 Agent 场景**：Claude 的 Server Tools、computer use、code execution、trained-in schema 工具更适合复杂工具生态。
- **偏开发效率和 Python 原型**：Gemini 的 Automatic Function Calling 可以用更少代码跑通闭环，适合快速验证和轻量工具集成。

最终，Function Calling 的本质不是某个 API 字段，而是一种系统架构边界：**模型负责理解意图和选择动作，应用负责执行动作和控制风险**。理解这一点，就掌握了工具调用工程化落地的 80%；剩下的 20%，才是各家 SDK 与平台能力的差异。

---

## 参考资料

- [OpenAI Function Calling 官方文档](https://developers.openai.com/api/docs/guides/function-calling)
- [Anthropic Claude Tool Use 官方文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [Google Gemini Function Calling 官方文档](https://ai.google.dev/gemini-api/docs/function-calling)
