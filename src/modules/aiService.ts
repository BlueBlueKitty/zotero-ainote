import { getPref } from "../utils/prefs";

type ProgressCb = (chunk: string) => Promise<void> | void;

/**
 * AIService: 调用用户配置的 OpenAI 兼容 Chat Completions 接口（支持流式）
 * 参考 zoterogpt 和 papersgpt 的实现方式：
 * - 使用 Zotero.HTTP.request 进行 POST 调用
 * - 开启 stream: true，并在 requestObserver.onprogress 中解析 SSE
 * - 解析形如 data: { choices[0].delta.content } 的内容增量
 */
export class AIService {
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
    const summaryPrompt = prompt || ((getPref("summaryPrompt") as string) || AIService.getDefaultPrompt());
    const streamEnabled = (getPref("stream") as boolean) ?? true;

    // 基本校验
    if (!apiUrl) {
      AIService.notifyError("API URL 未配置");
      throw new Error("API URL 未配置");
    }
    // 大多数服务需要 API Key；如你的服务明确不需要，可以在 UI 中留空并在此放行
    if (!apiKey) {
      AIService.notifyError("API Key 未配置");
      throw new Error("API Key 未配置");
    }

    // 构造 Chat Completions 消息（与参考插件一致的形态）
    const messages = AIService.buildMessages(summaryPrompt, fullText);

    // papersgpt/zoterogpt 的做法：直接请求 chat/completions，开启 stream，并解析 SSE 的增量
    const basePayload = {
      model,
      messages,
      temperature: Number(temperature),
    } as any;

    // 允许自定义服务直接使用配置的完整 URL（兼容 OpenAI/DeepSeek/OpenAI兼容服务）
    // 如果用户配置错误的末尾斜杠，不做强制修正，保持“照搬”逻辑

    // 累积结果与增量下发
    // 分支：流式 or 非流式
    if (streamEnabled && onProgress) {
      const body = JSON.stringify({ ...basePayload, stream: true });
      const chunks: string[] = [];
      let delivered = 0; // 已下发给 onProgress 的字符长度
      let gotAnyDelta = false;
      let processedLength = 0; // 已处理的响应长度，避免重复解析
      let partialLine = "";   // 进度事件之间可能存在被截断的半行 JSON
      let streamComplete = false; // 流是否正常结束
      let abortedDueToError = false; // 是否因错误而中止
      let errorFromProgress: Error | null = null; // 从 onprogress 中捕获的错误

      try {
        await Zotero.HTTP.request("POST", apiUrl, {
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body,
          responseType: "text",
          requestObserver: (xmlhttp: XMLHttpRequest) => {
            // 设置较长超时，避免网络异常时无限挂起
            xmlhttp.timeout = 300000; // 5 分钟
            
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
                  // 仅处理新增的响应文本，拼接上一次遗留的半行
                  const slice = partialLine + resp.slice(processedLength);
                  processedLength = resp.length;
                  const parts = slice.split(/\r?\n/);
                  // 若最后一段不是完整行，则缓存为 partial，下次继续
                  partialLine = parts[parts.length - 1].startsWith("data: ") && slice.endsWith("\n") ? "" : (parts.pop() || "");
                  
                  for (const raw of parts) {
                    if (!raw.startsWith("data: ")) continue;
                    const jsonStr = raw.replace(/^data: /, "").trim();
                    
                    if (jsonStr === "[DONE]") {
                      // 收到结束信号：标记完成
                      streamComplete = true;
                      return;
                    }
                    
                    try {
                      const json = JSON.parse(jsonStr);
                      // OpenAI/DeepSeek 兼容：choices[0].delta.content
                      const delta = json?.choices?.[0]?.delta?.content;
                      if (typeof delta === "string" && delta.length > 0) {
                        gotAnyDelta = true;
                        chunks.push(delta.replace(/\n+/g, "\n"));
                        const current = chunks.join("");
                        if (onProgress && current.length > delivered) {
                          const newChunk = current.slice(delivered);
                          delivered = current.length;
                          Promise.resolve(onProgress(newChunk)).catch((err) => {
                            ztoolkit.log("[AiNote] onProgress callback error:", err);
                          });
                        }
                      }
                    } catch {
                      // 忽略无法解析的行
                    }
                  }
                }
              } catch (err) {
                ztoolkit.log("[AiNote] stream parse error:", err);
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
        ztoolkit.log("[AiNote] Stream request failed:", {
          status: error?.xmlhttp?.status,
          statusText: error?.xmlhttp?.statusText,
          response: error?.xmlhttp?.response,
          message: error?.message
        });
        
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
      return await AIService.nonStreamCompletion(apiUrl, apiKey, basePayload, onProgress);
    } else {
      // 非流式：一次性拿到完整文本（也传递 onProgress 以支持弹出窗口显示）
      return await AIService.nonStreamCompletion(apiUrl, apiKey, basePayload, onProgress);
    }
  }

  // provider 已移除

  private static buildMessages(prompt: string, text: string) {
    // 与参考插件一致使用 chat messages 结构。这里提供简单的 system+user。
    return [
      { role: "system", content: "You are a helpful academic assistant." },
      {
        role: "user",
        content: `${prompt}\n\n请用中文回答。\n\n<Paper>\n${text}\n</Paper>`,
      },
    ];
  }

  private static getDefaultPrompt(): string {
    return `你是一名学术研究助理，请对下面的学术论文进行全面、结构化的中文总结。\n\n请包含：\n1. 研究目标与问题\n2. 研究方法与技术路线\n3. 主要发现与结果\n4. 结论与启示\n5. 局限性与未来方向\n\n要求：条理清晰、要点明确、使用中文回答。`;
  }

  // 默认提供商预设已移除

  private static notifyError(message: string) {
    new ztoolkit.ProgressWindow("AiNote", { closeOtherProgressWindows: false })
      .createLine({ text: message, type: "default" })
      .show();
  }

  private static async nonStreamCompletion(apiUrl: string, apiKey: string, payload: any, onProgress?: ProgressCb): Promise<string> {
    try {
      const res = await Zotero.HTTP.request("POST", apiUrl, {
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        responseType: "json",
      });
      const data = res.response || res;
      // OpenAI 兼容：choices[0].message.content
      const text = data?.choices?.[0]?.message?.content || "";
      const result = typeof text === "string" ? text : JSON.stringify(text);
      
      // 如果有 onProgress 回调，也调用它（模拟流式输出，一次性传递完整内容）
      if (onProgress && result) {
        try {
          await onProgress(result);
        } catch (err) {
          ztoolkit.log("[AiNote] onProgress error in non-stream mode:", err);
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
