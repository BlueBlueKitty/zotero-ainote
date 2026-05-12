ainote-prefs-heading = AiNote 设置
ainote-prefs-modelSection = 模型配置
ainote-prefs-apiKey = API Key：
ainote-prefs-apiUrl = API URL：
ainote-prefs-model = 模型：
ainote-prefs-temperature = 温度 (0-1)：
ainote-prefs-stream = 流式输出：
ainote-prefs-stream-hint = 开启后逐步输出；关闭则一次性输出。
ainote-prefs-truncateLength = 截断字符数（万）：
ainote-prefs-truncateLength-hint = 超过此字符数的文本将被截断（默认：10 万）
ainote-prefs-summaryPrompt = 提示词模板配置
ainote-prefs-webSummarySection = 网页版AI设置
ainote-prefs-currentPromptTemplate = 当前模板：
ainote-prefs-addPromptTemplate = 新增模板
ainote-prefs-resetPrompt = 恢复默认 Prompt
ainote-prefs-apiUrl-example = API URL 示例（OpenAI 兼容）：https://api.openai.com/v1/chat/completions

## 新设置页面标签
prefs-active-profile = 当前配置：
prefs-add-profile = 新增配置
prefs-pin-current-template = 固定使用当前提示词模板
prefs-pin-current-template-hint = 勾选后，右键菜单将不再展开模板二级菜单，而是始终使用上方当前选中的提示词模板进行总结。

## 新增配置对话框
prefs-add-dialog-title = 新增配置
prefs-add-dialog-subtitle = 先创建基础配置，再在下方继续填写接口地址、密钥和高级参数。
prefs-add-dialog-name = 配置名称
prefs-add-dialog-provider = 服务商
prefs-add-dialog-cancel = 取消
prefs-add-dialog-create = 创建
prefs-add-dialog-name-empty = 请填写配置名称
prefs-add-dialog-name-duplicate = 配置名称已存在，请使用其他名称

## 新增模板对话框
prefs-add-template-dialog-title = 新增模板
prefs-add-template-dialog-subtitle = 先创建模板名称，创建成功后再在下方配置区填写模板说明和模板内容。
prefs-add-template-dialog-name = 模板名称
prefs-add-template-dialog-cancel = 取消
prefs-add-template-dialog-create = 创建
prefs-add-template-dialog-name-empty = 模板名称不能为空
prefs-add-template-dialog-name-duplicate = 模板名称已存在，请使用其他名称

## 配置卡片标签
prefs-profile-name = 名称
prefs-profile-name-duplicate = 配置名称已存在，请使用其他名称
prefs-profile-name-empty = 配置名称不能为空
prefs-profile-provider = 服务商
prefs-profile-api-url = 接口地址
prefs-profile-api-key = API 密钥
prefs-profile-api-key-hint = 密钥会保存在本地配置中，用于调用当前服务商。
prefs-profile-model = 模型名称
prefs-profile-pdf-mode = PDF 处理模式
prefs-profile-pdf-mode-base64 = Base64（默认，直接提交 PDF）
prefs-profile-pdf-mode-text = 文本提取后提交
prefs-profile-pdf-mode-hint = Base64 模式会直接把 PDF 提交给支持多模态的模型；若当前接口不支持，生成时会自动切换为文本模式。MinerU 模式当前仅预留接口。
prefs-profile-text-truncate = 截断字符数（万）
prefs-profile-text-truncate-hint = 仅文本模式生效。会优先在句号处截断，再控制在该字符数附近。
prefs-profile-pdf-size-limit = PDF 大小限制（MB）
prefs-profile-pdf-size-limit-hint = 开启后会在处理前检查 PDF 文件大小，超过阈值则直接报错停止。
prefs-profile-azure-api-version = Azure API 版本
prefs-profile-azure-api-version-hint = 例如 2024-10-21。Azure OpenAI 请求需要明确 API 版本。
prefs-profile-azure-deployment = Azure 部署名
prefs-profile-azure-deployment-hint = 填写 Azure 上实际部署的模型名称，而不是公开模型名。
prefs-profile-temperature = 温度
prefs-profile-temperature-hint = 控制输出随机性。值越低越稳定，值越高越发散。
prefs-profile-top-p = Top P
prefs-profile-top-p-hint = 控制采样范围。通常与温度二选一即可。
prefs-profile-max-tokens = 最大 Token
prefs-profile-max-tokens-hint = 限制单次输出长度，防止返回过长内容或费用过高。
prefs-profile-stream = 流式输出
prefs-profile-stream-hint = 开启后会逐段显示模型输出，关闭后等待完整结果一次返回。
prefs-profile-timeout = 超时（毫秒）
prefs-profile-timeout-hint = 默认 30000 毫秒。超过该时间仍未返回时，本次请求会被终止。
prefs-profile-set-active = 设为当前
prefs-profile-enable = 启用
prefs-profile-disable = 停用
prefs-profile-clone = 复制
prefs-profile-delete = 删除
prefs-clone-name-suffix = -副本

## 模板卡片标签
prefs-template-name = 模板名称
prefs-template-name-label = 模板名称
prefs-template-desc = 模板说明
prefs-template-desc-label = 模板说明
prefs-template-content = 模板内容
prefs-template-content-label = 模板内容
prefs-template-desc-hint = 模板说明可留空，仅用于设置页中帮助区分模板用途。
prefs-template-content-hint = AI 请求时只会把这里的模板内容发送给模型；模板名称和说明不会进入提示词。
prefs-template-save = 保存
prefs-template-clone = 复制为新模板
prefs-template-delete = 删除模板
prefs-template-saved = 模板已保存
prefs-template-name-empty = 模板名称不能为空
prefs-template-content-empty = 模板内容不能为空
prefs-template-name-duplicate = 模板名称已存在，请使用其他名称

## 模型配置提示
prefs-model-hint-manual = 可以先手动填写模型，也可以通过"获取模型"从供应商读取可用模型。
prefs-model-fetch = 获取模型
prefs-model-test = 测试连接
prefs-model-fetching = 正在获取模型列表...
prefs-model-fetch-success = 获取成功，共 { $count } 个模型
prefs-model-fetch-empty = 接口可用，但未返回模型列表
prefs-model-selected = 已选择模型：{ $model }
prefs-model-testing = 正在测试连接...
prefs-model-test-success = 连接测试成功
prefs-model-test-fail = 连接测试失败
prefs-model-capability-yes = 当前模型看起来支持多模态/PDF 输入，适合使用 Base64 模式。
prefs-model-capability-no = 当前模型看起来不支持多模态/PDF 输入，建议改用文本模式。
prefs-model-capability-unknown = 请确认当前模型是否支持多模态/PDF 输入；若不支持，插件会自动回退到文本模式。

## 连接提示
prefs-connection-tip-azure = Azure 需要同时填写接口地址、部署名和 API 版本后再测试连接。
prefs-connection-tip-default = 可以先手动填写模型，也可以通过"获取模型"从供应商读取可用模型。

## 状态标签
prefs-enabled = 已启用
prefs-disabled = 已禁用
prefs-option-enabled = 已启用
prefs-option-disabled = 已禁用
prefs-default-template-label = [默认]
prefs-profile-disabled-label = [已停用]
prefs-profile-default-name = 配置
prefs-template-default-name = 自定义模板
prefs-profile-active-label = （当前使用）
prefs-profile-name-hint = 配置名称必须唯一，用来区分不同服务商或不同账号。
prefs-profile-api-url-hint = 填写该服务商的请求地址。OpenAI 兼容接口可以填写网关或代理提供的完整地址。

## Provider options (for runtimeT compatibility)
prefs-provider-azure = Azure OpenAI
prefs-provider-anthropic = Anthropic Claude
prefs-provider-gemini = Google Gemini
prefs-provider-deepseek = DeepSeek
prefs-provider-openai-compatible = OpenAI [Chat Completions 接口]
prefs-provider-openai = OpenAI [Responses 接口]
prefs-web-summary-enable = 启用网页版总结入口
prefs-web-summary-enable-hint = 开启后会在 Zotero 条目右键菜单中显示“使用网页版大模型总结”。
prefs-web-summary-auto-start-bridge = 启动时自动启动本地 Bridge
prefs-web-summary-auto-start-bridge-hint = 插件启动后自动监听 127.0.0.1 本地端口，供浏览器扩展领取任务。
prefs-web-summary-enable-continue-chat = 启用“继续对话”右键菜单
prefs-web-summary-enable-continue-chat-hint = 仅对已记录会话映射的文献显示，用于打开对应的 ChatGPT 历史对话。
prefs-web-summary-bridge-port = Bridge 端口
prefs-web-summary-bridge-port-hint = 默认 23123。浏览器扩展中的 Bridge URL 需要与这里保持一致。
prefs-web-summary-chatgpt-mode = ChatGPT 模式
prefs-web-summary-chatgpt-mode-thinking = Thinking
prefs-web-summary-chatgpt-mode-instant = Instant
prefs-web-summary-chatgpt-mode-hint = 扩展会在发送前尝试切换网页端的 Instant / Thinking 模式。
prefs-web-summary-project-url = ChatGPT 项目 URL
prefs-web-summary-project-url-hint = 填写完整项目页地址，例如 https://chatgpt.com/g/g-p-xxxx/project。插件会优先主动打开该链接。
prefs-web-summary-poll-interval = 轮询间隔（毫秒）
prefs-web-summary-poll-interval-hint = Zotero 轮询本地 Bridge 任务状态的时间间隔。
prefs-web-summary-timeout = 本地请求超时（毫秒）
prefs-web-summary-timeout-hint = Zotero 访问本地 Bridge 的单次超时限制。
