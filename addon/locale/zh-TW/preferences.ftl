ainote-prefs-heading = AiNote 設定
ainote-prefs-modelSection = 模型配置
ainote-prefs-apiKey = API Key：
ainote-prefs-apiUrl = API URL：
ainote-prefs-model = 模型：
ainote-prefs-temperature = 溫度 (0-1)：
ainote-prefs-stream = 串流輸出：
ainote-prefs-stream-hint = 開啟後逐步輸出；關閉則一次性輸出。
ainote-prefs-truncateLength = 截斷字元數（萬）：
ainote-prefs-truncateLength-hint = 超過此字元數的文字將被截斷（預設：10 萬）
ainote-prefs-summaryPrompt = 提示詞模板配置
ainote-prefs-currentPromptTemplate = 當前模板：
ainote-prefs-addPromptTemplate = 新增模板
ainote-prefs-resetPrompt = 恢復預設 Prompt
ainote-prefs-apiUrl-example = API URL 範例（OpenAI 相容）：https://api.openai.com/v1/chat/completions

## 新設定頁面標籤
prefs-active-profile = 目前配置：
prefs-add-profile = 新增配置
prefs-pin-current-template = 固定使用目前提示詞模板
prefs-pin-current-template-hint = 勾選後，右鍵選單將不再展開模板二級選單，而是始終使用上方目前選中的提示詞模板進行總結。

## 新增配置對話框
prefs-add-dialog-title = 新增配置
prefs-add-dialog-subtitle = 先建立基礎配置，再在下方繼續填寫介面地址、金鑰和高級參數。
prefs-add-dialog-name = 配置名稱
prefs-add-dialog-provider = 服務商
prefs-add-dialog-cancel = 取消
prefs-add-dialog-create = 建立
prefs-add-dialog-name-empty = 請填寫配置名稱
prefs-add-dialog-name-duplicate = 配置名稱已存在，請使用其他名稱

## 新增模板對話框
prefs-add-template-dialog-title = 新增模板
prefs-add-template-dialog-subtitle = 先建立模板名稱，建立成功後再在下方配置區填寫模板說明和模板內容。
prefs-add-template-dialog-name = 模板名稱
prefs-add-template-dialog-cancel = 取消
prefs-add-template-dialog-create = 建立
prefs-add-template-dialog-name-empty = 模板名稱不能為空
prefs-add-template-dialog-name-duplicate = 模板名稱已存在，請使用其他名稱

## 配置卡片標籤
prefs-profile-name = 名稱
prefs-profile-name-duplicate = 配置名稱已存在，請使用其他名稱
prefs-profile-name-empty = 配置名稱不能為空
prefs-profile-provider = 服務商
prefs-profile-api-url = 介面地址
prefs-profile-api-key = API 金鑰
prefs-profile-api-key-hint = 金鑰會保存在本地配置中，用於呼叫目前服務商。
prefs-profile-model = 模型名稱
prefs-profile-pdf-mode = PDF 處理模式
prefs-profile-pdf-mode-base64 = Base64（預設，直接提交 PDF）
prefs-profile-pdf-mode-text = 文字提取後提交
prefs-profile-pdf-mode-hint = Base64 模式會直接把 PDF 提交給支援多模態的模型；若目前介面不支援，產生時會自動切換為文字模式。MinerU 模式目前僅預留介面。
prefs-profile-text-truncate = 截斷字元數（萬）
prefs-profile-text-truncate-hint = 僅文字模式生效。會優先在句號處截斷，再控制在該字元數附近。
prefs-profile-pdf-size-limit = PDF 大小限制（MB）
prefs-profile-pdf-size-limit-hint = 開啟後會在處理前檢查 PDF 檔案大小，超過閾值則直接報錯停止。
prefs-profile-azure-api-version = Azure API 版本
prefs-profile-azure-api-version-hint = 例如 2024-10-21。Azure OpenAI 請求需要明確 API 版本。
prefs-profile-azure-deployment = Azure 部署名
prefs-profile-azure-deployment-hint = 填寫 Azure 上實際部署的模型名稱，而不是公開模型名。
prefs-profile-temperature = 溫度
prefs-profile-temperature-hint = 控制輸出隨機性。值越低越穩定，值越高越發散。
prefs-profile-top-p = Top P
prefs-profile-top-p-hint = 控制取樣範圍。通常與溫度二選一即可。
prefs-profile-max-tokens = 最大 Token
prefs-profile-max-tokens-hint = 限制單次輸出長度，防止回傳過長內容或費用過高。
prefs-profile-stream = 串流輸出
prefs-profile-stream-hint = 開啟後會逐段顯示模型輸出，關閉後等待完整結果一次回傳。
prefs-profile-timeout = 逾時（毫秒）
prefs-profile-timeout-hint = 預設 30000 毫秒。超過該時間仍未回傳時，本次請求會被終止。
prefs-profile-set-active = 設為目前
prefs-profile-enable = 啟用
prefs-profile-disable = 停用
prefs-profile-clone = 複製
prefs-profile-delete = 刪除
prefs-clone-name-suffix = -副本

## 模板卡片標籤
prefs-template-name = 模板名稱
prefs-template-name-label = 模板名稱
prefs-template-desc = 模板說明
prefs-template-desc-label = 模板說明
prefs-template-content = 模板內容
prefs-template-content-label = 模板內容
prefs-template-desc-hint = 模板說明可留空，僅用於設定頁中幫助區分模板用途。
prefs-template-content-hint = AI 請求時只會把這裡的模板內容發送給模型；模板名稱和說明不會進入提示詞。
prefs-template-save = 儲存
prefs-template-clone = 複製為新模板
prefs-template-delete = 刪除模板
prefs-template-saved = 模板已儲存
prefs-template-name-empty = 模板名稱不能為空
prefs-template-content-empty = 模板內容不能為空
prefs-template-name-duplicate = 模板名稱已存在，請使用其他名稱

## 模型配置提示
prefs-model-hint-manual = 可以先手動填寫模型，也可以透過「取得模型」從供應商讀取可用模型。
prefs-model-fetch = 取得模型
prefs-model-test = 測試連線
prefs-model-fetching = 正在取得模型清單...
prefs-model-fetch-success = 取得成功，共 { $count } 個模型
prefs-model-fetch-empty = 介面可用，但未回傳模型清單
prefs-model-selected = 已選擇模型：{ $model }
prefs-model-testing = 正在測試連線...
prefs-model-test-success = 連線測試成功
prefs-model-test-fail = 連線測試失敗
prefs-model-capability-yes = 目前模型看起來支援多模態/PDF 輸入，適合使用 Base64 模式。
prefs-model-capability-no = 目前模型看起來不支援多模態/PDF 輸入，建議改用文字模式。
prefs-model-capability-unknown = 請確認目前模型是否支援多模態/PDF 輸入；若不支援，外掛程式會自動回退到文字模式。

## 連線提示
prefs-connection-tip-azure = Azure 需要同時填寫介面地址、部署名和 API 版本後再測試連線。
prefs-connection-tip-default = 可以先手動填寫模型，也可以透過「取得模型」從供應商讀取可用模型。

## 狀態標籤
prefs-enabled = 已啟用
prefs-disabled = 已停用
prefs-option-enabled = 已啟用
prefs-option-disabled = 已停用
prefs-default-template-label = [預設]
prefs-profile-disabled-label = [已停用]
prefs-profile-default-name = 配置
prefs-template-default-name = 自訂模板
prefs-profile-active-label = （目前使用）
prefs-profile-name-hint = 配置名稱必須唯一，用來區分不同服務商或不同帳號。
prefs-profile-api-url-hint = 填寫該服務商的請求地址。OpenAI 相容介面可以填寫閘道或代理提供的完整地址。

## Provider options (for runtimeT compatibility)
prefs-provider-azure = Azure OpenAI
prefs-provider-anthropic = Anthropic Claude
prefs-provider-gemini = Google Gemini
prefs-provider-deepseek = DeepSeek
prefs-provider-openai-compatible = OpenAI [Chat Completions 介面]
prefs-provider-openai = OpenAI [Responses 介面]
