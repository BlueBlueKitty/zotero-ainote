import { getPref } from "../utils/prefs";
import { 
  getDefaultSummaryPrompt, 
  SYSTEM_ROLE_PROMPT, 
  buildUserMessage 
} from "../utils/prompts";

type ProgressCb = (chunk: string) => Promise<void> | void;

/**
 * 支持的 AI 服务提供商类型
 */
enum ProviderType {
  OpenAI = "openai",
  DeepSeek = "deepseek",
  Azure = "azure",
  Gemini = "gemini",
  Claude = "claude",
  Custom = "custom"
}

/**
 * AIService: 调用用户配置的 AI API 接口（支持流式）
 * 根据配置的 API URL 自动识别服务提供商类型并适配调用方式：
 * - OpenAI/DeepSeek/Azure: 标准 OpenAI 格式
 * - Gemini: 原生 contents/parts 格式
 * - Claude: Anthropic 格式
 * - 使用 Zotero.HTTP.request 进行 POST 调用
 * - 开启 stream: true，并在 requestObserver.onprogress 中解析 SSE
 */
export class AIService {
  /**
   * 根据 API URL 自动检测服务提供商类型
   */
  private static detectProvider(apiUrl: string): ProviderType {
    const url = apiUrl.toLowerCase();
    
    // OpenAI 官方或兼容服务
    if (url.includes("api.openai.com")) {
      return ProviderType.OpenAI;
    }
    
    // DeepSeek
    if (url.includes("api.deepseek.com")) {
      return ProviderType.DeepSeek;
    }
    
    // Azure OpenAI
    if (url.includes("openai.azure.com")) {
      return ProviderType.Azure;
    }
    
    // Google Gemini
    if (url.includes("generativelanguage.googleapis.com")) {
      return ProviderType.Gemini;
    }
    
    // Anthropic Claude
    if (url.includes("api.anthropic.com")) {
      return ProviderType.Claude;
    }
    
    // 默认按 OpenAI 兼容格式处理
    return ProviderType.Custom;
  }
  /**
   * 根据全文生成总结（流式）
   * @param fullText 文献全文（已清洗/截断）
   * @param prompt 可选自定义提示词，若未传则使用偏好设置中的 summaryPrompt
   * @param onProgress 流式增量回调（每次追加新 token 时被调用）
   * @returns 最终完整总结文本
   */
  static async generateSummary(
    fullText: string,
    prompt?: string,
    onProgress?: ProgressCb,
  ): Promise<string> {
    // 单一全局配置
    const apiKey = ((getPref("apiKey" as any) as string) || "").trim();
    const apiUrl = ((getPref("apiUrl" as any) as string) || "").trim();
    const model = ((getPref("model" as any) as string) || "gpt-3.5-turbo").trim();
    
    const temperatureStr = (getPref("temperature") as string) || "0.7";
    const temperature = parseFloat(temperatureStr) || 0.7;
    
    // 获取 prompt，确保不会是 undefined
    const savedPrompt = getPref("summaryPrompt") as string;
    const summaryPrompt = prompt || (savedPrompt && savedPrompt.trim() ? savedPrompt : getDefaultSummaryPrompt());
    const streamEnabled = (getPref("stream") as boolean) ?? true;
    
    // 检测服务提供商类型
    const providerType = AIService.detectProvider(apiUrl);
    
    // 基本校验
    if (!apiUrl) {
      AIService.notifyError("API URL 未配置");
      throw new Error("API URL 未配置");
    }
    // Gemini 通过 URL 参数传递 key，其他服务需要 API Key
    if (!apiKey && providerType !== ProviderType.Gemini) {
      AIService.notifyError("API Key 未配置");
      throw new Error("API Key 未配置");
    }

    // 根据提供商类型构造不同格式的消息
    const messages = AIService.buildMessages(summaryPrompt, fullText, providerType);

    // papersgpt/zoterogpt 的做法：直接请求 chat/completions，开启 stream，并解析 SSE 的增量
    const basePayload = {
      model,
      messages,
      temperature: Number(temperature),
    } as any;

    // 允许自定义服务直接使用配置的完整 URL（兼容 OpenAI/DeepSeek/OpenAI兼容服务）
    // 如果用户配置错误的末尾斜杠，不做强制修正，保持“照搬”逻辑

    // 累积结果与增量下发
    // 根据提供商类型适配请求
    const { url: adaptedUrl, headers: adaptedHeaders, payload: adaptedPayload } = 
      AIService.adaptRequest(apiUrl, apiKey, basePayload, providerType, streamEnabled);
    
    // 分支：流式 or 非流式
    if (streamEnabled && onProgress) {
      // Gemini 通过 URL 区分流式/非流式，不需要 stream 参数
      // 其他服务需要在请求体中添加 stream: true
      const streamPayload = providerType === ProviderType.Gemini 
        ? adaptedPayload 
        : { ...adaptedPayload, stream: true };
      const body = JSON.stringify(streamPayload);
      const chunks: string[] = [];
      let delivered = 0; // 已下发给 onProgress 的字符长度
      let gotAnyDelta = false;
      let processedLength = 0; // 已处理的响应长度，避免重复解析
      let partialLine = "";   // 进度事件之间可能存在被截断的半行 JSON
      let streamComplete = false; // 流是否正常结束
      let abortedDueToError = false; // 是否因错误而中止
      let errorFromProgress: Error | null = null; // 从 onprogress 中捕获的错误

      try {
        await Zotero.HTTP.request("POST", adaptedUrl, {
          headers: adaptedHeaders,
          body,
          responseType: "text",
          requestObserver: (xmlhttp: XMLHttpRequest) => {
            // 设置超时时间为 120 秒，配合动态重置机制避免流式响应超时
            xmlhttp.timeout = 300000; // 300 秒（5 分钟）
            
            xmlhttp.onprogress = (e: any) => {
              const status = e.target.status;
              
              // 检查 HTTP 状态码，如果是错误状态，尝试解析错误信息
              if (status >= 400) {
                try {
                  const errorResponse = e.target.response;
                  if (errorResponse) {
                    // 尝试解析错误 JSON
                    const parsed = JSON.parse(errorResponse);
                    const err = parsed?.error || parsed;
                    const code = err?.code || `HTTP ${status}`;
                    const msg = err?.message || "请求失败";
                    const errorMessage = `${code}: ${msg}`;
                    AIService.notifyError(errorMessage);
                    // 设置错误标志
                    abortedDueToError = true;
                    errorFromProgress = new Error(errorMessage);
                    // 中止请求
                    xmlhttp.abort();
                  }
                } catch (parseErr) {
                  const errorMessage = `HTTP ${status}: 请求失败`;
                  AIService.notifyError(errorMessage);
                  abortedDueToError = true;
                  errorFromProgress = new Error(errorMessage);
                  xmlhttp.abort();
                }
                return;
              }
              
              try {
                const resp: string = e.target.response || "";
                
                if (resp.length > processedLength) {
                  // Gemini 流式响应是 JSON 数组格式，不是 SSE
                  if (providerType === ProviderType.Gemini) {
                    // Gemini: 增量解析 JSON 数组中的对象
                    // 响应格式: [{...}, {...}, ...]
                    // 策略: 手动扫描完整的 JSON 对象 '{...}'，不依赖 JSON.parse 解析整个数组
                    
                    let i = processedLength;
                    let braceCount = 0;
                    let inString = false;
                    let escape = false;
                    let objectStart = -1;
                    
                    while (i < resp.length) {
                      const char = resp[i];
                      
                      if (objectStart === -1) {
                        // 寻找对象开始 '{'
                        if (char === '{') {
                          objectStart = i;
                          braceCount = 1;
                        }
                        // 忽略其他字符（如 [ , \n \r ] 等）
                      } else {
                        // 在对象内
                        if (!inString) {
                          if (char === '"') {
                            inString = true;
                          } else if (char === '{') {
                            braceCount++;
                          } else if (char === '}') {
                            braceCount--;
                            if (braceCount === 0) {
                              // 找到完整对象
                              const jsonStr = resp.substring(objectStart, i + 1);
                              try {
                                const json = JSON.parse(jsonStr);
                                const delta = AIService.parseStreamDelta(json, providerType);
                                if (typeof delta === "string" && delta.length > 0) {
                                  gotAnyDelta = true;
                                  chunks.push(delta);
                                  
                                  // 立即更新 UI
                                  const current = chunks.join("");
                                  if (onProgress && current.length > delivered) {
                                    const newChunk = current.slice(delivered);
                                    delivered = current.length;
                                    Promise.resolve(onProgress(newChunk)).catch((err) => {
                                      // ignore
                                    });
                                  }
                                }
                                // 更新 processedLength 到当前对象结束
                                processedLength = i + 1;
                                objectStart = -1; // 重置，寻找下一个对象
                              } catch (e) {
                                // 解析失败，重置
                                objectStart = -1;
                              }
                            }
                          }
                        } else {
                          // 在字符串内
                          if (escape) {
                            escape = false;
                          } else if (char === '\\') {
                            escape = true;
                          } else if (char === '"') {
                            inString = false;
                          }
                        }
                      }
                      i++;
                    }
                  } else {
                    // OpenAI/DeepSeek/Claude: SSE 格式
                    // 同时也支持 NDJSON (如 Ollama Native)
                    const slice = partialLine + resp.slice(processedLength);
                    processedLength = resp.length;
                    const parts = slice.split(/\r?\n/);
                    
                    // 处理被截断的行
                    const lastChar = slice.slice(-1);
                    if (lastChar !== '\n' && lastChar !== '\r') {
                        partialLine = parts.pop() || "";
                    } else {
                        partialLine = "";
                        // split 在以分隔符结尾时会产生空字符串，移除它
                        if (parts.length > 0 && parts[parts.length - 1] === "") {
                            parts.pop();
                        }
                    }
                    
                    for (const raw of parts) {
                      let jsonStr = "";
                      
                      if (raw.startsWith("data: ")) {
                        // SSE 格式
                        jsonStr = raw.replace(/^data: /, "").trim();
                        if (jsonStr === "[DONE]") {
                          streamComplete = true;
                          return;
                        }
                      } else if (raw.trim().startsWith("{")) {
                        // NDJSON 格式 (Ollama Native 等)
                        jsonStr = raw.trim();
                      } else {
                        // 忽略 event: ping 等其他行
                        continue;
                      }
                      
                      if (!jsonStr) continue;
                      
                      try {
                        const json = JSON.parse(jsonStr);
                        // 根据提供商类型解析不同的响应格式
                        const delta = AIService.parseStreamDelta(json, providerType);
                        if (typeof delta === "string" && delta.length > 0) {
                          gotAnyDelta = true;
                          chunks.push(delta.replace(/\n+/g, "\n"));
                          const current = chunks.join("");
                          if (onProgress && current.length > delivered) {
                            const newChunk = current.slice(delivered);
                            delivered = current.length;
                            Promise.resolve(onProgress(newChunk)).catch((err) => {
                              // ignore
                            });
                          }
                        }
                      } catch {
                        // 忽略无法解析的行
                      }
                    }
                  }
                }
              } catch (err) {
                // ignore
              }
              
              // 每次收到数据时重置超时计时器，避免长时间流式响应被误判为超时
              if (e.target.timeout) {
                e.target.timeout = 0;
              }
            };
            
            xmlhttp.onerror = () => {
              // XMLHttpRequest error
            };
            
            xmlhttp.ontimeout = () => {
              // XMLHttpRequest timeout
            };
            
            xmlhttp.onloadend = () => {
              const status = xmlhttp.status;
              
              // 检查 HTTP 状态码
              if (status >= 400) {
                // 错误会在外层 catch 中处理
                return;
              }
            };
          },
        });
      } catch (error: any) {
        // 检查是否是因为错误而主动中止的
        if (abortedDueToError && errorFromProgress) {
          throw errorFromProgress;
        }
        
        // 检查是否是正常的流结束（有些API在收到[DONE]后会关闭连接导致"错误"）
        if (streamComplete && gotAnyDelta) {
          return chunks.join("");
        }
        
        // 真正的错误 - 记录完整错误信息
        
        // 解析并显示错误
        let errorMessage = "未知错误";
        try {
          const responseText = error?.xmlhttp?.response || error?.xmlhttp?.responseText;
          if (responseText) {
            const parsed = JSON.parse(responseText);
            const err = parsed?.error || parsed;
            const code = err?.code || "Error";
            const msg = err?.message || error?.message || String(error);
            errorMessage = `${code}: ${msg}`;
          } else {
            errorMessage = error?.message || String(error);
          }
        } catch (parseError) {
          errorMessage = error?.message || error?.xmlhttp?.statusText || String(error);
        }
        
        AIService.notifyError(errorMessage);
        throw new Error(errorMessage);
      }

      const streamed = chunks.join("");
      if (gotAnyDelta && streamed) {
        return streamed;
      }

      // 若未拿到任何增量，回退到非流式
      return await AIService.nonStreamCompletion(apiUrl, apiKey, basePayload, providerType, onProgress);
    } else {
      // 非流式：一次性拿到完整文本（也传递 onProgress 以支持弹出窗口显示）
      return await AIService.nonStreamCompletion(apiUrl, apiKey, basePayload, providerType, onProgress);
    }
  }

  /**
   * 根据提供商类型构造不同格式的消息
   */
  private static buildMessages(prompt: string, text: string, providerType: ProviderType) {
    const userMessage = buildUserMessage(prompt, text);
    
    // Gemini 使用 contents 格式
    if (providerType === ProviderType.Gemini) {
      return [
        {
          role: "user",
          parts: [{ text: `${SYSTEM_ROLE_PROMPT}\n\n${userMessage}` }]
        }
      ];
    }
    
    // Claude 使用 system 参数而非 messages
    if (providerType === ProviderType.Claude) {
      return [
        { role: "user", content: userMessage }
      ];
    }
    
    // OpenAI/DeepSeek/Azure/Custom 使用标准格式
    return [
      { role: "system", content: SYSTEM_ROLE_PROMPT },
      { role: "user", content: userMessage },
    ];
  }

  /**
   * 根据提供商类型适配请求的 URL、headers 和 payload
   */
  private static adaptRequest(
    apiUrl: string, 
    apiKey: string, 
    basePayload: any,
    providerType: ProviderType,
    isStreaming: boolean = false
  ): { url: string; headers: Record<string, string>; payload: any } {
    let url = apiUrl;
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    let payload = { ...basePayload };
    
    switch (providerType) {
      case ProviderType.Gemini: {
        // Gemini: 根据模型名和流式选项构建完整 URL
        // 用户只需输入基础 URL: https://generativelanguage.googleapis.com/v1beta/models
        // 格式: {baseUrl}/{model}:{streamGenerateContent|generateContent}?key={apiKey}
        
        let baseUrl = apiUrl;
        const model = basePayload.model || "gemini-pro";
        
        // 移除可能的尾部斜杠
        if (baseUrl.endsWith('/')) {
          baseUrl = baseUrl.slice(0, -1);
        }
        
        // 如果用户已经输入了完整的端点 URL（包含模型和方法），保持原样
        if (baseUrl.includes(':generateContent') || baseUrl.includes(':streamGenerateContent')) {
          // 用户输入了完整 URL，只需根据流式选项调整
          if (isStreaming && baseUrl.includes(':generateContent') && !baseUrl.includes(':streamGenerateContent')) {
            url = baseUrl.replace(':generateContent', ':streamGenerateContent');
          } else if (!isStreaming && baseUrl.includes(':streamGenerateContent')) {
            url = baseUrl.replace(':streamGenerateContent', ':generateContent');
          } else {
            url = baseUrl;
          }
        } else {
          // 用户只输入了基础 URL，自动拼接模型和端点
          
          // 自动补全路径: 如果不包含 /models，尝试补全
          if (!baseUrl.includes('/models')) {
             if (baseUrl.endsWith('/v1beta')) {
                 baseUrl = `${baseUrl}/models`;
             } else {
                 // 假设是根域名 https://generativelanguage.googleapis.com
                 baseUrl = `${baseUrl}/v1beta/models`;
             }
          }

          const endpoint = isStreaming ? 'streamGenerateContent' : 'generateContent';
          url = `${baseUrl}/${model}:${endpoint}`;
        }
        
        // API key 通过 URL 参数传递
        url = apiKey ? `${url}?key=${apiKey}` : url;
        
        // Gemini 使用 contents 而非 messages
        // buildMessages 已经返回了正确的 contents 格式，直接使用
        payload = {
          contents: basePayload.messages, // 这里 messages 实际上已经是 Gemini 的 contents 格式
          generationConfig: {
            temperature: basePayload.temperature,
            maxOutputTokens: 8192,
          }
        };
        
        // 删除 Gemini 不支持的参数
        delete payload.model; // Gemini 在 URL 中指定模型
        delete payload.messages;
        delete payload.stream; // Gemini 不使用 stream 参数，而是通过 URL 区分
        break;
      }
        
      case ProviderType.Azure: {
        // Azure OpenAI: URL 格式需要包含 deployment 名称
        // 用户可输入基础 URL: https://your-resource.openai.azure.com/openai/deployments
        // 格式: {baseUrl}/{deployment}/chat/completions?api-version=2023-05-15
        
        let baseUrl = apiUrl;
        const deployment = basePayload.model || "gpt-35-turbo"; // Azure 中 model 字段作为 deployment 名称
        
        // 移除可能的尾部斜杠
        if (baseUrl.endsWith('/')) {
          baseUrl = baseUrl.slice(0, -1);
        }
        
        // 检查用户是否已经输入了完整的端点 URL
        if (baseUrl.includes('/chat/completions')) {
          // 已经是完整 URL，直接使用
          url = baseUrl;
        } else if (baseUrl.includes('/deployments/')) {
          // 包含 /deployments/ 但没有 /chat/completions，追加端点
          // 检查是否已有 api-version 参数
          if (baseUrl.includes('?api-version=')) {
            url = baseUrl.replace('?api-version=', '/chat/completions?api-version=');
          } else {
            url = `${baseUrl}/chat/completions?api-version=2023-05-15`;
          }
        } else {
          // 只输入了基础 URL，自动拼接 deployment 和端点
          // 检查是否是根域名格式 (https://xxx.openai.azure.com)
          if (!baseUrl.includes('/openai/deployments')) {
             baseUrl = `${baseUrl}/openai/deployments`;
          }
          url = `${baseUrl}/${deployment}/chat/completions?api-version=2023-05-15`;
        }
        
        // Azure: 使用 api-key header
        headers["api-key"] = apiKey;
        break;
      }
        
      case ProviderType.Claude: {
        // Claude: 使用 x-api-key header 和 anthropic-version
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
        
        // 自动补全 URL
        if (!url.includes('/v1/messages')) {
           url = url.endsWith('/') ? `${url}v1/messages` : `${url}/v1/messages`;
        }

        // Claude 的 system prompt 作为单独参数
        const systemMessage = basePayload.messages.find((m: any) => m.role === "system");
        if (systemMessage) {
          payload.system = systemMessage.content;
          payload.messages = basePayload.messages.filter((m: any) => m.role !== "system");
        }
        
        // Claude 必须包含 max_tokens
        if (!payload.max_tokens) {
          payload.max_tokens = 4096;
        }
        break;
      }
        
      case ProviderType.OpenAI:
      case ProviderType.DeepSeek:
      case ProviderType.Custom:
      default: {
        // OpenAI/DeepSeek/Custom: 标准 Bearer token
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }
        
        // 自动补全 URL (仅针对已知服务商或明显的根域名)
        if (providerType === ProviderType.OpenAI && !url.includes('/chat/completions')) {
           url = url.endsWith('/') ? `${url}v1/chat/completions` : `${url}/v1/chat/completions`;
        } else if (providerType === ProviderType.DeepSeek && !url.includes('/chat/completions')) {
           url = url.endsWith('/') ? `${url}chat/completions` : `${url}/chat/completions`;
        }
        break;
      }
    }
    
    return { url, headers, payload };
  }
  
  /**
   * 根据提供商类型解析流式响应的增量内容
   */
  private static parseStreamDelta(json: any, providerType: ProviderType): string | null {
    switch (providerType) {
      case ProviderType.Gemini:
        // Gemini: candidates[0].content.parts[0].text
        return json?.candidates?.[0]?.content?.parts?.[0]?.text || null;
        
      case ProviderType.Claude:
        // Claude: delta.text
        return json?.delta?.text || null;
        
      case ProviderType.OpenAI:
      case ProviderType.DeepSeek:
      case ProviderType.Azure:
      case ProviderType.Custom:
      default:
        // OpenAI 标准: choices[0].delta.content
        // Ollama Native (NDJSON): message.content
        return json?.choices?.[0]?.delta?.content || json?.message?.content || null;
    }
  }

  private static notifyError(message: string) {
    new ztoolkit.ProgressWindow("AiNote", { closeOtherProgressWindows: false })
      .createLine({ text: message, type: "default" })
      .show();
  }

  private static async nonStreamCompletion(
    apiUrl: string, 
    apiKey: string,
    basePayload: any,
    providerType: ProviderType,
    onProgress?: ProgressCb
  ): Promise<string> {
    // 为非流式请求适配 URL、headers 和 payload
    const { url: adaptedUrl, headers: adaptedHeaders, payload: adaptedPayload } = 
      AIService.adaptRequest(apiUrl, apiKey, basePayload, providerType, false);
    
    try {
      const res = await Zotero.HTTP.request("POST", adaptedUrl, {
        headers: adaptedHeaders,
        body: JSON.stringify(adaptedPayload),
        responseType: "json",
      });
      const data = res.response || res;
      
      // 根据提供商类型解析响应
      let text = "";
      switch (providerType) {
        case ProviderType.Gemini:
          // Gemini: candidates[0].content.parts[0].text
          text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          break;
        case ProviderType.Claude:
          // Claude: content[0].text
          text = data?.content?.[0]?.text || "";
          break;
        default:
          // OpenAI/DeepSeek/Azure/Custom: choices[0].message.content
          // Ollama Native: message.content
          text = data?.choices?.[0]?.message?.content || data?.message?.content || "";
          break;
      }
      
      const result = typeof text === "string" ? text : JSON.stringify(text);
      
      // 如果有 onProgress 回调，也调用它（模拟流式输出，一次性传递完整内容）
      if (onProgress && result) {
        try {
          await onProgress(result);
        } catch (err) {
          // ignore
        }
      }
      
      return result;
    } catch (error: any) {
      // 解析并显示错误
      let errorMessage = "未知错误";
      try {
        const responseText = error?.xmlhttp?.response || error?.xmlhttp?.responseText;
        if (responseText) {
          const parsed = typeof responseText === 'string' ? JSON.parse(responseText) : responseText;
          const err = parsed?.error || parsed;
          const code = err?.code || "Error";
          const msg = err?.message || error?.message || String(error);
          errorMessage = `${code}: ${msg}`;
        } else {
          errorMessage = error?.message || String(error);
        }
      } catch (parseError) {
        errorMessage = error?.message || error?.xmlhttp?.statusText || String(error);
      }
      
      AIService.notifyError(errorMessage);
      throw new Error(errorMessage);
    }
  }
}

export default AIService;
