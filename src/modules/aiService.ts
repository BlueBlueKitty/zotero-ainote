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
    
    // temperature 存储为整数 0-100，使用时除以 100 得到 0.0-1.0
    const temperatureInt = (getPref("temperature") as number) ?? 70;
    const temperature = temperatureInt / 100;
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
                      ztoolkit.log("[AiNote] Stream completed with [DONE] signal");
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
                            ztoolkit.log("[AiNote] onProgress error:", err);
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
            
            xmlhttp.onloadend = () => {
              // 当请求结束时，如果收到了 [DONE] 则标记为成功
              if (streamComplete) {
                ztoolkit.log("[AiNote] Stream request completed successfully");
              }
            };
          },
        });
      } catch (error: any) {
        // 检查是否是正常的流结束（有些API在收到[DONE]后会关闭连接导致"错误"）
        if (streamComplete && gotAnyDelta) {
          ztoolkit.log("[AiNote] Stream ended normally after [DONE]");
          return chunks.join("");
        }
        
        // 真正的错误
        try {
          const parsed = JSON.parse(error?.xmlhttp?.response);
          const err = parsed?.error || parsed;
          const code = err?.code || "Error";
          const msg = err?.message || error?.message || String(error);
          AIService.notifyError(`${code}: ${msg}`);
        } catch {
          AIService.notifyError(error?.message || String(error));
        }
        throw error;
      }

      const streamed = chunks.join("");
      if (gotAnyDelta && streamed) {
        ztoolkit.log("[AiNote] Stream completed, total length:", streamed.length);
        return streamed;
      }

      // 若未拿到任何增量，回退到非流式
      ztoolkit.log("[AiNote] No stream delta received, falling back to non-stream.");
      return await AIService.nonStreamCompletion(apiUrl, apiKey, basePayload);
    } else {
      // 非流式：一次性拿到完整文本
      return await AIService.nonStreamCompletion(apiUrl, apiKey, basePayload);
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

  private static async nonStreamCompletion(apiUrl: string, apiKey: string, payload: any): Promise<string> {
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
      return typeof text === "string" ? text : JSON.stringify(text);
    } catch (error: any) {
      try {
        const parsed = JSON.parse(error?.xmlhttp?.response);
        const err = parsed?.error || parsed;
        const code = err?.code || "Error";
        const msg = err?.message || error?.message || String(error);
        AIService.notifyError(`${code}: ${msg}`);
      } catch {
        AIService.notifyError(error?.message || String(error));
      }
      throw error;
    }
  }
}

export default AIService;
