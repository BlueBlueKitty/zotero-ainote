# AI 服务配置指南

本插件支持多种 AI API 服务，会根据您配置的 API URL 自动识别服务类型并适配调用方式。

## 支持的 AI 服务

### 1. OpenAI

- **API URL**: `https://api.openai.com/v1/chat/completions`
- **API Key**: 您的 OpenAI API Key
- **Model**: `gpt-3.5-turbo`, `gpt-4`, `gpt-4-turbo` 等

### 2. DeepSeek

- **API URL**: `https://api.deepseek.com/v1/chat/completions`
- **API Key**: 您的 DeepSeek API Key
- **Model**: `deepseek-chat`, `deepseek-coder` 等

### 3. Azure OpenAI

- **API URL**: `https://your-resource.openai.azure.com/openai/deployments/your-deployment/chat/completions?api-version=2023-05-15`
- **API Key**: 您的 Azure API Key
- **Model**: 部署名称（在 URL 中指定）

### 4. Google Gemini

- **API URL**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent`
- **API Key**: 您的 Google AI Studio API Key
- **Model**: URL 中指定（如 `gemini-pro`, `gemini-1.5-pro`）

**注意**: Gemini 使用原生 API 格式，API Key 通过 URL 参数传递。

### 5. Anthropic Claude

- **API URL**: `https://api.anthropic.com/v1/messages`
- **API Key**: 您的 Anthropic API Key
- **Model**: `claude-3-opus-20240229`, `claude-3-sonnet-20240229` 等

### 6. 其他 OpenAI 兼容服务

任何兼容 OpenAI API 格式的第三方服务都可以使用，只需填写正确的 URL 和 API Key。

## 配置步骤

1. 打开 Zotero 偏好设置
2. 找到 "AiNote" 插件设置
3. 填写以下参数：
   - **API Key**: 您的服务商提供的 API 密钥
   - **API URL**: 服务端点地址（见上方示例）
   - **Model**: 模型名称（部分服务可能在 URL 中指定）
   - **Temperature**: 温度参数（0-1，控制输出随机性）
   - **Stream**: 是否启用流式输出

4. 保存设置后，插件会自动根据 URL 识别服务类型并适配调用方式

## 自动识别规则

插件通过检查 API URL 中的关键词来识别服务类型：

- 包含 `api.openai.com` → OpenAI
- 包含 `api.deepseek.com` → DeepSeek
- 包含 `openai.azure.com` → Azure OpenAI
- 包含 `generativelanguage.googleapis.com` → Google Gemini
- 包含 `api.anthropic.com` → Anthropic Claude
- 其他 → 按 OpenAI 兼容格式处理

## 常见问题

### Q: 我的服务商兼容 OpenAI API，但 URL 不包含上述关键词

A: 没问题！插件会将未识别的服务按 OpenAI 兼容格式处理，只要服务商遵循 OpenAI API 规范即可。

### Q: Gemini API 返回 404 错误

A: 请确保您的 API URL 格式正确，模型名称应在 URL 中指定，例如：

```
https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent
```

### Q: Azure OpenAI 如何配置

A: Azure 使用 `api-key` header 而非 `Authorization`，插件会自动处理。确保 URL 中包含正确的资源名、部署名和 API 版本。

## 技术说明

不同服务使用不同的请求/响应格式：

- **OpenAI/DeepSeek/Azure**: 标准 `messages` 格式
- **Gemini**: 使用 `contents/parts` 格式
- **Claude**: `system` 参数独立于 `messages`

插件会自动处理这些差异，您无需手动调整。
