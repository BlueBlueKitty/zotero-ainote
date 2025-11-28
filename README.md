# AiNote for Zotero 插件

<p align="center">
    <img src="./imgs/ainote.png" alt="AiNote Logo" width="150" height="150" />
</p>

<p align="center">
    <a href="./doc/README_en-US.md">English README</a>
</p>

## 简介

AiNote 是一款 Zotero 插件，通过 AI 自动为 PDF 文献生成总结笔记，插件支持流式输出、批量处理。

## 功能亮点

- **AI 智能总结 PDF**：一键生成学术论文的精炼笔记，支持多种 AI 服务。
- **实时流式显示**：在弹出窗口中实时查看 AI 生成的内容，支持流式输出。
- **批量处理**：可批量选择文献，统一生成笔记，每个条目内容清晰分隔。
- **自动保存笔记**：流式输出完成后，内容自动保存到 Zotero 笔记中。
- **自定义模型与提示词**：可灵活调整模型、API 地址和提示词。

## 使用方法

- 在 Zotero 中选中一个或多个 PDF 文献。
- 右键选择 `生成AI总结笔记`。
- 插件会弹出一个输出窗口，实时显示 AI 生成的内容。
- 处理多个条目时，每个条目的内容会清晰标注并分隔显示。
- 处理完成后，所有总结内容会自动保存到对应的 Zotero 笔记中。
- 您可以随时关闭输出窗口。

<div align="center">
    <span style="display:inline-block; border-radius:12px; overflow:hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.18);">
        <img src="./imgs/example.gif" alt="usage example" style="display:block;" />
    </span>
</div>

## 安装方法

1. 从 [GitHub 仓库](https://github.com/BlueBlueKitty/zotero-ainote/releases) 下载最新版本。
2. 在 Zotero 中进入 `工具 > 插件`，安装 AiNote 插件。
3. 如有需要，重启 Zotero。

## 配置说明

### 基本配置

在 Zotero 的 `工具 > AiNote 偏好设置` 中配置以下参数：

- **API Key**：您的 AI 服务 API 密钥
- **API URL**：AI 服务的端点地址
- **Model**：要使用的模型名称
- **Temperature**：控制输出随机性（0-1）
- **Stream**：是否启用流式输出

插件会根据您配置的 **API URL** 自动识别服务提供商并适配调用方式，无需手动选择服务类型。

### 支持的 AI 服务配置

#### 1. OpenAI

```
API URL: https://api.openai.com/v1/chat/completions
API Key: sk-xxx...
Model: gpt-4o, gpt-4-turbo, gpt-3.5-turbo 等
```

#### 2. DeepSeek

```
API URL: https://api.deepseek.com/chat/completions
API Key: sk-xxx...
Model: deepseek-chat, deepseek-coder
```

#### 3. Google Gemini

**简化配置（推荐）**：

```
API URL: https://generativelanguage.googleapis.com
API Key: AIza...
Model: gemini-2.5-flash, gemini-1.5-pro, 等
```

**完整配置**：

```
API URL: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent
API Key: AIza...
Model: (可留空)
```

> 💡 **提示**：使用简化配置时，只需修改 Model 字段即可切换不同的 Gemini 模型，无需修改 URL。插件会自动补全 `/v1beta/models` 路径。

#### 4. Azure OpenAI

**简化配置（推荐）**：

```
API URL: https://your-resource.openai.azure.com
API Key: your-api-key
Model: gpt-4 (您的 deployment 名称)
```

**完整配置**：

```
API URL: https://your-resource.openai.azure.com/openai/deployments/gpt-4/chat/completions?api-version=2023-05-15
API Key: your-api-key
Model: (可留空)
```

> 💡 **提示**：Azure 中 Model 字段对应您的 deployment 名称。使用简化配置时，插件会自动拼接路径。

#### 5. Anthropic Claude

**简化配置（推荐）**：

```
API URL: https://api.anthropic.com
API Key: sk-ant-xxx...
Model: claude-3-5-sonnet-20240620, claude-3-opus-20240229 等
```

**完整配置**：

```
API URL: https://api.anthropic.com/v1/messages
API Key: sk-ant-xxx...
Model: (同上)
```

#### 6. Ollama (本地运行)

支持 Ollama 原生 API 格式：

```
API URL: http://localhost:11434/api/chat
API Key: (任意填写，如 ollama)
Model: llama3, mistral, qwen2 等
```

#### 7. 其他 OpenAI 兼容服务

任何兼容 OpenAI API 格式的服务都可使用：

```
API URL: https://your-service.com/v1/chat/completions
API Key: your-api-key
Model: your-model-name
```

### 自动识别规则

插件通过 API URL 中的关键词自动识别服务类型：

| URL 关键词                          | 识别为       | 特殊处理                     |
| ----------------------------------- | ------------ | ---------------------------- |
| `api.openai.com`                    | OpenAI       | 标准格式                     |
| `api.deepseek.com`                  | DeepSeek     | 标准格式                     |
| `generativelanguage.googleapis.com` | Gemini       | 原生格式，支持简化 URL       |
| `openai.azure.com`                  | Azure OpenAI | api-key header，支持简化 URL |
| `api.anthropic.com`                 | Claude       | Anthropic 格式               |
| 其他                                | OpenAI 兼容  | 标准格式                     |
