ainote-prefs-heading = AiNote Preferences
ainote-prefs-modelSection = Model Settings
ainote-prefs-apiKey = API Key:
ainote-prefs-apiUrl = API URL:
ainote-prefs-model = Model:
ainote-prefs-temperature = Temperature (0-1):
ainote-prefs-stream = Streaming Output:
ainote-prefs-stream-hint = If enabled, output incrementally; otherwise, output once when complete.
ainote-prefs-truncateLength = Truncate Length (10k chars):
ainote-prefs-truncateLength-hint = Text exceeding this character count will be truncated (default: 10)
ainote-prefs-summaryPrompt = Prompt Template Settings
ainote-prefs-webSummarySection = Web AI Settings
ainote-prefs-currentPromptTemplate = Current Template:
ainote-prefs-addPromptTemplate = Add Template
ainote-prefs-resetPrompt = Restore Default Prompt
ainote-prefs-apiUrl-example = API URL example (OpenAI-compatible): https://api.openai.com/v1/chat/completions

## New preference UI labels
prefs-active-profile = Current Profile:
prefs-add-profile = Add Profile
prefs-pin-current-template = Pin Current Prompt Template
prefs-pin-current-template-hint = When checked, the right-click menu will not expand the template submenu, always using the currently selected prompt template.

## Add profile dialog
prefs-add-dialog-title = New Profile
prefs-add-dialog-subtitle = Create a basic profile first, then fill in the API URL, key, and advanced parameters below.
prefs-add-dialog-name = Profile Name
prefs-add-dialog-provider = Provider
prefs-add-dialog-cancel = Cancel
prefs-add-dialog-create = Create
prefs-add-dialog-name-empty = Please enter a profile name
prefs-add-dialog-name-duplicate = Profile name already exists, please use a different name

## Add template dialog
prefs-add-template-dialog-title = New Template
prefs-add-template-dialog-subtitle = First create the template name, then fill in the description and content below.
prefs-add-template-dialog-name = Template Name
prefs-add-template-dialog-cancel = Cancel
prefs-add-template-dialog-create = Create
prefs-add-template-dialog-name-empty = Template name cannot be empty
prefs-add-template-dialog-name-duplicate = Template name already exists, please use a different name

## Profile card labels
prefs-profile-name = Name
prefs-profile-name-duplicate = Profile name already exists, please use a different name
prefs-profile-name-empty = Profile name cannot be empty
prefs-profile-provider = Provider
prefs-profile-api-url = API URL
prefs-profile-api-key = API Key
prefs-profile-api-key-hint = The key is stored locally and used to call the current service provider.
prefs-profile-model = Model Name
prefs-profile-pdf-mode = PDF Processing Mode
prefs-profile-pdf-mode-base64 = Base64 (default, submit PDF directly)
prefs-profile-pdf-mode-text = Extract text then submit
prefs-profile-pdf-mode-hint = Base64 mode submits the PDF directly to multimodal-capable models. If the current API does not support it, it will automatically fall back to text mode. MinerU mode is reserved for future use.
prefs-profile-text-truncate = Truncate Length (10k chars)
prefs-profile-text-truncate-hint = Only effective in text mode. Will prioritize truncation at sentence boundaries to stay near this character count.
prefs-profile-pdf-size-limit = PDF Size Limit (MB)
prefs-profile-pdf-size-limit-hint = When enabled, checks the PDF file size before processing and stops with an error if it exceeds the threshold.
prefs-profile-azure-api-version = Azure API Version
prefs-profile-azure-api-version-hint = e.g. 2024-10-21. Azure OpenAI requests require an explicit API version.
prefs-profile-azure-deployment = Azure Deployment Name
prefs-profile-azure-deployment-hint = Enter the actual deployed model name on Azure, not the public model name.
prefs-profile-temperature = Temperature
prefs-profile-temperature-hint = Controls output randomness. Lower values are more stable, higher values are more diverse.
prefs-profile-top-p = Top P
prefs-profile-top-p-hint = Controls sampling range. Usually use either temperature or top-p, not both.
prefs-profile-max-tokens = Max Tokens
prefs-profile-max-tokens-hint = Limits single response length to prevent overly long content or high costs.
prefs-profile-stream = Streaming Output
prefs-profile-stream-hint = When enabled, displays model output incrementally. When disabled, waits for the complete result.
prefs-profile-timeout = Timeout (ms)
prefs-profile-timeout-hint = Default 30000 ms. The request will be terminated if no response is received within this time.
prefs-profile-set-active = Set Active
prefs-profile-enable = Enable
prefs-profile-disable = Disable
prefs-profile-clone = Clone
prefs-profile-delete = Delete
prefs-clone-name-suffix = -copy

## Template card labels
prefs-template-name = Template Name
prefs-template-name-label = Template Name
prefs-template-desc = Description
prefs-template-desc-label = Description
prefs-template-content = Content
prefs-template-content-label = Content
prefs-template-desc-hint = Description is optional, only used to distinguish template purposes.
prefs-template-content-hint = Only the template content will be sent to the model during AI requests; the name and description are not included.
prefs-template-save = Save
prefs-template-clone = Clone as New Template
prefs-template-delete = Delete Template
prefs-template-saved = Template saved
prefs-template-name-empty = Template name cannot be empty
prefs-template-content-empty = Template content cannot be empty
prefs-template-name-duplicate = Template name already exists, please use a different name

## Model configuration hints
prefs-model-hint-manual = You can manually enter the model name, or click "Fetch Models" to load available models from the provider.
prefs-model-fetch = Fetch Models
prefs-model-test = Test Connection
prefs-model-fetching = Fetching model list...
prefs-model-fetch-success = Fetched successfully, { $count } models found
prefs-model-fetch-empty = API is available but returned no models
prefs-model-selected = Selected model: { $model }
prefs-model-testing = Testing connection...
prefs-model-test-success = Connection successful
prefs-model-test-fail = Connection failed
prefs-model-capability-yes = This model appears to support multimodal/PDF input, suitable for Base64 mode.
prefs-model-capability-no = This model appears not to support multimodal/PDF input, consider using text mode instead.
prefs-model-capability-unknown = Please confirm if this model supports multimodal/PDF input. If not, the plugin will fall back to text mode.

## Connection tips
prefs-connection-tip-azure = Azure requires filling in API URL, deployment name, and API version before testing.
prefs-connection-tip-default = You can manually enter the model, or click "Fetch Models" to load available models from the provider.

## Status labels
prefs-enabled = Enabled
prefs-disabled = Disabled
prefs-option-enabled = Enabled
prefs-option-disabled = Disabled
prefs-default-template-label = [Default]
prefs-profile-disabled-label = [Disabled]

## Provider options
prefs-provider-azure = Azure OpenAI
prefs-provider-anthropic = Anthropic Claude
prefs-provider-gemini = Google Gemini
prefs-provider-deepseek = DeepSeek
prefs-provider-openai-compatible = OpenAI [Chat Completions API]
prefs-provider-openai = OpenAI [Responses API]
prefs-web-summary-enable = Enable web summary menu
prefs-web-summary-enable-hint = Shows “Summarize with Web AI” in the Zotero item context menu.
prefs-web-summary-auto-start-bridge = Auto-start local bridge on startup
prefs-web-summary-auto-start-bridge-hint = Start listening on a 127.0.0.1 local port when the plugin loads.
prefs-web-summary-enable-continue-chat = Enable “continue chat” menu
prefs-web-summary-enable-continue-chat-hint = Only shown for items that already have a mapped ChatGPT conversation.
prefs-web-summary-bridge-port = Bridge port
prefs-web-summary-bridge-port-hint = Default is 23123. Keep the extension Bridge URL in sync with this value.
prefs-web-summary-chatgpt-mode = ChatGPT mode
prefs-web-summary-chatgpt-mode-thinking = Thinking
prefs-web-summary-chatgpt-mode-instant = Instant
prefs-web-summary-chatgpt-mode-hint = The extension will try to switch the ChatGPT web UI to Instant or Thinking before sending.
prefs-web-summary-project-url = ChatGPT project URL
prefs-web-summary-project-url-hint = Enter the full project page URL, for example https://chatgpt.com/g/g-p-xxxx/project. The plugin will proactively open this link first.
prefs-web-summary-poll-interval = Poll interval (ms)
prefs-web-summary-poll-interval-hint = How often Zotero polls the local bridge for task status updates.
prefs-web-summary-timeout = Local request timeout (ms)
prefs-web-summary-timeout-hint = Timeout for a single Zotero request to the local bridge.
prefs-profile-default-name = Profile
prefs-template-default-name = Custom Template
prefs-profile-active-label =  (Active)
prefs-profile-name-hint = Profile name must be unique, used to distinguish different providers or accounts.
prefs-profile-api-url-hint = Enter the request URL for this provider. OpenAI-compatible APIs can use the full URL from a gateway or proxy.
