import { getPref } from "../utils/prefs";
import {
  getDefaultSummaryPrompt,
  SYSTEM_ROLE_PROMPT,
  buildUserMessage,
} from "../utils/prompts";
import {
  ProviderProfile,
  ProviderType,
  parseProfiles,
  normalizeProfile,
} from "./llmProfiles";

type ProgressCb = (chunk: string) => Promise<void> | void;

export type LLMModelInfo = {
  id: string;
  name?: string;
};

type LLMRequest = {
  content: string;
  contentMode: "text" | "pdf-base64";
  summaryPrompt: string;
  profile: ProviderProfile;
  onProgress?: ProgressCb;
};

type LLMClient = {
  generateSummary(req: LLMRequest): Promise<string>;
  listModels(profile: ProviderProfile): Promise<LLMModelInfo[]>;
  testConnection(profile: ProviderProfile): Promise<string>;
  supportsPdfBase64(profile: ProviderProfile): boolean;
};

function asNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeParseError(error: any): string {
  try {
    const responseText = error?.xmlhttp?.response || error?.xmlhttp?.responseText;
    if (responseText) {
      const parsed = typeof responseText === "string" ? JSON.parse(responseText) : responseText;
      const err = parsed?.error || parsed;
      const code = err?.code || err?.type || "Error";
      const msg = err?.message || error?.message || String(error);
      return `${code}: ${msg}`;
    }
  } catch {
    // ignore
  }
  return error?.message || String(error);
}

async function postJson(url: string, headers: Record<string, string>, payload: any, timeoutMs: number): Promise<any> {
  const res = await Zotero.HTTP.request("POST", url, {
    headers,
    body: JSON.stringify(payload),
    responseType: "json",
    timeout: timeoutMs,
    errorDelayMax: 0,
  });
  return res.response || res;
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<any> {
  const res = await Zotero.HTTP.request("GET", url, {
    headers,
    responseType: "json",
    timeout: timeoutMs,
    errorDelayMax: 0,
  });
  return res.response || res;
}

function getTimeoutMs(profile: ProviderProfile): number {
  return parseInt(profile.requestTimeoutMs || "30000", 10) || 30000;
}

function withOptionalOpenAIParams(profile: ProviderProfile, payload: any) {
  if (profile.extra?.enableTemperature !== false) {
    payload.temperature = asNumber(profile.temperature, 0.7);
  }
  if (profile.extra?.enableTopP) {
    payload.top_p = asNumber(profile.topP, 1);
  }
  if (profile.extra?.enableMaxTokens) {
    payload.max_tokens = parseInt(profile.maxTokens || "4096", 10) || 4096;
  }
  return payload;
}

function withOptionalGeminiParams(profile: ProviderProfile, generationConfig: any) {
  if (profile.extra?.enableTemperature !== false) {
    generationConfig.temperature = asNumber(profile.temperature, 0.7);
  }
  if (profile.extra?.enableTopP) {
    generationConfig.topP = asNumber(profile.topP, 1);
  }
  if (profile.extra?.enableMaxTokens) {
    generationConfig.maxOutputTokens =
      parseInt(profile.maxTokens || "4096", 10) || 4096;
  }
  return generationConfig;
}

function withOptionalAnthropicParams(profile: ProviderProfile, payload: any) {
  if (profile.extra?.enableTemperature !== false) {
    payload.temperature = asNumber(profile.temperature, 0.7);
  }
  if (profile.extra?.enableMaxTokens) {
    payload.max_tokens = parseInt(profile.maxTokens || "4096", 10) || 4096;
  } else if (!payload.max_tokens) {
    payload.max_tokens = 4096;
  }
  return payload;
}

function ensureAbsoluteUrl(url: string, label: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`${label} 必须是完整地址，例如 https://api.openai.com/v1/chat/completions`);
  }
  return trimmed;
}

function normalizeOpenAIChatEndpoint(baseUrl: string): string {
  const raw = ensureAbsoluteUrl(baseUrl, "接口地址").replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(raw)) return raw;
  if (/\/responses$/i.test(raw)) {
    return raw.replace(/\/responses$/i, "/chat/completions");
  }
  if (/\/v\d+(?:beta)?$/i.test(raw)) return `${raw}/chat/completions`;
  if (/\/v\d+(?:beta)?\/.+$/i.test(raw)) {
    return raw.replace(/(\/v\d+(?:beta)?)(?:\/.*)?$/i, "$1/chat/completions");
  }
  return `${raw}/v1/chat/completions`;
}

function normalizeOpenAIResponsesEndpoint(baseUrl: string): string {
  const raw = ensureAbsoluteUrl(baseUrl, "接口地址").replace(/\/+$/, "");
  if (/\/responses$/i.test(raw)) return raw;
  if (/\/chat\/completions$/i.test(raw)) {
    return raw.replace(/\/chat\/completions$/i, "/responses");
  }
  if (/\/v\d+(?:beta)?$/i.test(raw)) return `${raw}/responses`;
  if (/\/v\d+(?:beta)?\/.+$/i.test(raw)) {
    return raw.replace(/(\/v\d+(?:beta)?)(?:\/.*)?$/i, "$1/responses");
  }
  return `${raw}/v1/responses`;
}

function normalizeOpenAIModelsEndpoint(baseUrl: string): string {
  const raw = ensureAbsoluteUrl(baseUrl, "接口地址").replace(/\/+$/, "");
  if (/\/models$/i.test(raw)) return raw;
  if (/\/chat\/completions$/i.test(raw)) {
    return raw.replace(/\/chat\/completions$/i, "/models");
  }
  if (/\/responses$/i.test(raw)) {
    return raw.replace(/\/responses$/i, "/models");
  }
  if (/\/v\d+(?:beta)?$/i.test(raw)) return `${raw}/models`;
  if (/\/v\d+(?:beta)?\/.+$/i.test(raw)) {
    return raw.replace(/(\/v\d+(?:beta)?)(?:\/.*)?$/i, "$1/models");
  }
  return `${raw}/v1/models`;
}

function parseOpenAIResponsesText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const outputs = Array.isArray(data?.output) ? data.output : [];
  const collected: string[] = [];
  for (const item of outputs) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      if (typeof content?.text === "string" && content.text) {
        collected.push(content.text);
        continue;
      }
      if (typeof content?.output_text === "string" && content.output_text) {
        collected.push(content.output_text);
        continue;
      }
      if (Array.isArray(content?.content)) {
        for (const nested of content.content) {
          if (typeof nested?.text === "string" && nested.text) {
            collected.push(nested.text);
          }
        }
      }
    }
  }
  return collected.join("");
}

function parseOpenAIResponsesDelta(event: any): string | null {
  if (
    event?.type === "response.output_text.delta" &&
    typeof event?.delta === "string"
  ) {
    return event.delta;
  }
  return null;
}

function extractOpenAICompatText(content: any): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.text?.value === "string") return part.text.value;
        if (typeof part?.content?.[0]?.text === "string") return part.content[0].text;
        return "";
      })
      .join("");
  }
  if (typeof content?.text === "string") {
    return content.text;
  }
  if (typeof content?.text?.value === "string") {
    return content.text.value;
  }
  return "";
}

function parseOpenAICompatDelta(event: any): string | null {
  const delta = event?.choices?.[0]?.delta?.content;
  const extracted = extractOpenAICompatText(delta);
  if (extracted) return extracted;
  const messageContent = extractOpenAICompatText(event?.message?.content);
  return messageContent || null;
}

function parseOpenAICompatText(data: any): string {
  const choice = data?.choices?.[0];
  const messageText = extractOpenAICompatText(choice?.message?.content);
  if (messageText) return messageText;
  const deltaText = extractOpenAICompatText(choice?.delta?.content);
  if (deltaText) return deltaText;
  const directMessage = extractOpenAICompatText(data?.message?.content);
  if (directMessage) return directMessage;
  return "";
}

function extractAnthropicText(data: any): string {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .map((block: any) => {
      if (block?.type === "text" && typeof block?.text === "string") {
        return block.text;
      }
      return "";
    })
    .join("");
}

function parseAnthropicDelta(event: any): string | null {
  if (event?.type === "content_block_delta" && typeof event?.delta?.text === "string") {
    return event.delta.text;
  }
  return null;
}

function extractGeminiText(json: any): string {
  try {
    const cand0 = json?.candidates?.[0];
    if (!cand0) return "";

    const extractTextFromParts = (parts: any[]): string => {
      if (!Array.isArray(parts)) return "";
      return parts
        .filter((p: any) => !p?.thought)
        .map((p: any) => p?.text || "")
        .join("");
    };

    const deltaParts = cand0?.delta?.content?.parts || cand0?.delta?.parts;
    if (Array.isArray(deltaParts)) {
      return extractTextFromParts(deltaParts);
    }

    const parts = cand0?.content?.parts;
    if (Array.isArray(parts)) {
      return extractTextFromParts(parts);
    }

    const singlePart = cand0?.content?.parts?.[0];
    if (singlePart?.thought) return "";
    const text = singlePart?.text || cand0?.text;
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}

async function postStream(
  url: string,
  headers: Record<string, string>,
  payload: any,
  timeoutMs: number,
  onProgress: ProgressCb,
  parseChunk: (json: any) => string | null,
): Promise<string> {
  const chunks: string[] = [];
  let delivered = 0;
  let processedLength = 0;
  let pendingText = "";
  let abortError: Error | null = null;

  try {
    await Zotero.HTTP.request("POST", url, {
      headers,
      body: JSON.stringify(payload),
      responseType: "text",
      timeout: timeoutMs,
      errorDelayMax: 0,
      requestObserver: (xmlhttp: XMLHttpRequest) => {
        xmlhttp.onprogress = (e: any) => {
          const status = e.target.status;
          if (status >= 400) {
            try {
              const errorResponse = e.target.response;
              const parsed = errorResponse ? JSON.parse(errorResponse) : null;
              const err = parsed?.error || parsed || {};
              const code = err?.code || err?.type || `HTTP ${status}`;
              const msg = err?.message || "请求失败";
              abortError = new Error(`${code}: ${msg}`);
            } catch {
              abortError = new Error(`HTTP ${status}: 请求失败`);
            }
            try {
              xmlhttp.abort();
            } catch {
              // ignore
            }
            return;
          }

          const resp: string = e.target.response || "";
          if (resp.length <= processedLength) return;

          pendingText += resp.slice(processedLength);
          processedLength = resp.length;

          const normalized = pendingText.replace(/\r\n/g, "\n");
          const events = normalized.split("\n\n");
          pendingText = events.pop() || "";

          for (const rawEvent of events) {
            const trimmedEvent = rawEvent.trim();
            if (!trimmedEvent) continue;

            const lines = trimmedEvent.split("\n");
            const dataLines: string[] = [];
            for (const line of lines) {
              if (line.startsWith("data:")) {
                dataLines.push(line.replace(/^data:\s*/, ""));
              } else if (line.trim().startsWith("{")) {
                dataLines.push(line.trim());
              }
            }

            const candidates = dataLines.length
              ? [dataLines.join("\n"), ...dataLines]
              : [];

            for (const candidate of candidates) {
              const jsonStr = candidate.trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;
              try {
                const json = JSON.parse(jsonStr);
                const delta = parseChunk(json);
                if (delta) {
                  chunks.push(delta);
                  const current = chunks.join("");
                  if (current.length > delivered) {
                    const newChunk = current.slice(delivered);
                    delivered = current.length;
                    Promise.resolve(onProgress(newChunk)).catch(() => {
                      // ignore
                    });
                  }
                }
                break;
              } catch {
                // try next candidate shape
              }
            }
          }
        };
        xmlhttp.onerror = () => {
          if (!abortError) {
            abortError = new Error("连接至服务器时发生错误。请检查网络连接。");
          }
        };
        xmlhttp.ontimeout = () => {
          if (!abortError) {
            abortError = new Error(`请求超时（>${timeoutMs} ms）`);
          }
        };
      },
    });
  } catch (error: any) {
    if (abortError) {
      if (chunks.length > 0) {
        return chunks.join("");
      }
      throw abortError;
    }
    if (chunks.length > 0) {
      return chunks.join("");
    }
    return "";
  }

  return chunks.join("");
}

class OpenAICompatClient implements LLMClient {
  supportsPdfBase64(_profile: ProviderProfile): boolean {
    return false;
  }

  protected getHeaders(profile: ProviderProfile): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${profile.apiKey}`,
      ...(profile.extra?.headers || {}),
    };
  }

  protected getChatEndpoint(profile: ProviderProfile): string {
    return normalizeOpenAIChatEndpoint(profile.baseUrl);
  }

  protected getModelsEndpoint(profile: ProviderProfile): string {
    return normalizeOpenAIModelsEndpoint(profile.baseUrl);
  }

  async generateSummary(req: LLMRequest): Promise<string> {
    const { profile, summaryPrompt, content, onProgress } = req;
    if (!profile.apiKey) throw new Error("API Key 未配置");
    if (!profile.baseUrl) throw new Error("API URL 未配置");

    const payload = withOptionalOpenAIParams(profile, {
      model: profile.model,
      messages: [
        { role: "system", content: SYSTEM_ROLE_PROMPT },
        { role: "user", content: buildUserMessage(summaryPrompt, content) },
      ],
    });

    const headers = this.getHeaders(profile);
    const timeoutMs = getTimeoutMs(profile);
    const endpoint = this.getChatEndpoint(profile);
    if (profile.stream && onProgress) {
      const text = await postStream(
        endpoint,
        headers,
        { ...payload, stream: true },
        timeoutMs,
        onProgress,
        parseOpenAICompatDelta,
      );
      if (text) return text;
    }

    const data = await postJson(endpoint, headers, payload, timeoutMs);
    return parseOpenAICompatText(data);
  }

  async listModels(profile: ProviderProfile): Promise<LLMModelInfo[]> {
    if (!profile.apiKey) throw new Error("API 密钥未配置");
    if (!profile.baseUrl) throw new Error("接口地址未配置");
    const data = await getJson(
      this.getModelsEndpoint(profile),
      this.getHeaders(profile),
      getTimeoutMs(profile),
    );
    return Array.isArray(data?.data)
      ? data.data.map((item: any) => ({
          id: String(item?.id || "").trim(),
          name: item?.name ? String(item.name) : undefined,
        })).filter((item: LLMModelInfo) => !!item.id)
      : [];
  }

  async testConnection(profile: ProviderProfile): Promise<string> {
    const models = await this.listModels(profile);
    if (models.length > 0) {
      return `连接成功，共获取到 ${models.length} 个模型`;
    }
    return "连接成功，但未获取到模型列表";
  }
}

class OpenAIClient extends OpenAICompatClient {
  override supportsPdfBase64(_profile: ProviderProfile): boolean {
    return true;
  }

  protected override getChatEndpoint(profile: ProviderProfile): string {
    return normalizeOpenAIResponsesEndpoint(profile.baseUrl);
  }

  async generateSummary(req: LLMRequest): Promise<string> {
    const { profile, summaryPrompt, content, contentMode, onProgress } = req;
    if (!profile.apiKey) throw new Error("API Key 未配置");
    if (!profile.baseUrl) throw new Error("API URL 未配置");

    const payload: any = {
      model: profile.model,
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: SYSTEM_ROLE_PROMPT }],
        },
        {
          role: "user",
          content:
            contentMode === "pdf-base64"
              ? [
                  { type: "input_text", text: summaryPrompt },
                  {
                    type: "input_file",
                    filename: "paper.pdf",
                    file_data: `data:application/pdf;base64,${content}`,
                  },
                ]
              : [
                  {
                    type: "input_text",
                    text: buildUserMessage(summaryPrompt, content),
                  },
                ],
        },
      ],
    };
    if (profile.extra?.enableTemperature !== false) {
      payload.temperature = asNumber(profile.temperature, 0.7);
    }
    if (profile.extra?.enableTopP) {
      payload.top_p = asNumber(profile.topP, 1);
    }
    if (profile.extra?.enableMaxTokens) {
      payload.max_output_tokens =
        parseInt(profile.maxTokens || "4096", 10) || 4096;
    }

    const headers = this.getHeaders(profile);
    const timeoutMs = getTimeoutMs(profile);
    const endpoint = this.getChatEndpoint(profile);

    if (profile.stream && onProgress) {
      const text = await postStream(
        endpoint,
        headers,
        { ...payload, stream: true },
        timeoutMs,
        onProgress,
        parseOpenAIResponsesDelta,
      );
      if (text) return text;
    }

    const data = await postJson(endpoint, headers, payload, timeoutMs);
    return parseOpenAIResponsesText(data);
  }

  override async testConnection(profile: ProviderProfile): Promise<string> {
    if (!profile.apiKey) throw new Error("API 密钥未配置");
    if (!profile.baseUrl) throw new Error("接口地址未配置");

    const payload: any = {
      model: profile.model,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "Reply with OK." }],
        },
      ],
      max_output_tokens: 16,
      stream: false,
    };

    const data = await postJson(
      this.getChatEndpoint(profile),
      this.getHeaders(profile),
      payload,
      getTimeoutMs(profile),
    );
    const text = parseOpenAIResponsesText(data) || "OK";
    return `连接成功，响应：${text}`;
  }
}
class DeepSeekClient extends OpenAICompatClient {}

class AzureOpenAIClient extends OpenAICompatClient {
  override supportsPdfBase64(_profile: ProviderProfile): boolean {
    return false;
  }
  private buildEndpoint(profile: ProviderProfile): string {
    const deployment = profile.extra?.deployment || profile.model;
    if (!deployment) throw new Error("Azure deployment 未配置");

    const version = profile.apiVersion || "2024-10-21";
    let baseUrl = profile.baseUrl.replace(/\/+$/, "");
    baseUrl = ensureAbsoluteUrl(baseUrl, "接口地址");
    const versionQuery = `api-version=${encodeURIComponent(version)}`;

    if (/\/chat\/completions/i.test(baseUrl)) {
      return baseUrl.includes("api-version=")
        ? baseUrl
        : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${versionQuery}`;
    }

    if (!/\/openai\/deployments/i.test(baseUrl)) {
      baseUrl = `${baseUrl}/openai/deployments`;
    }
    return `${baseUrl}/${deployment}/chat/completions?${versionQuery}`;
  }

  protected override getChatEndpoint(profile: ProviderProfile): string {
    return this.buildEndpoint(profile);
  }

  protected override getHeaders(profile: ProviderProfile): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "api-key": profile.apiKey,
      ...(profile.extra?.headers || {}),
    };
  }

  async generateSummary(req: LLMRequest): Promise<string> {
    return super.generateSummary(req);
  }

  async listModels(profile: ProviderProfile): Promise<LLMModelInfo[]> {
    const deployment = String(profile.extra?.deployment || profile.model || "").trim();
    if (!deployment) {
      throw new Error("Azure 目前需要先填写部署名后才能使用");
    }
    return [{ id: deployment, name: "当前 Azure 部署" }];
  }

  async testConnection(profile: ProviderProfile): Promise<string> {
    if (!profile.apiKey) throw new Error("API 密钥未配置");
    if (!profile.baseUrl) throw new Error("接口地址未配置");
    const payload = withOptionalOpenAIParams(profile, {
      model: profile.model,
      messages: [
        { role: "system", content: "You are a connectivity test assistant." },
        { role: "user", content: "Reply with OK." },
      ],
      max_tokens: 8,
    });
    await postJson(
      this.buildEndpoint(profile),
      this.getHeaders(profile),
      payload,
      getTimeoutMs(profile),
    );
    return "连接成功";
  }
}

class AnthropicClient implements LLMClient {
  supportsPdfBase64(_profile: ProviderProfile): boolean {
    return true;
  }

  async generateSummary(req: LLMRequest): Promise<string> {
    const { profile, summaryPrompt, content, contentMode, onProgress } = req;
    if (!profile.apiKey) throw new Error("API Key 未配置");
    if (!profile.baseUrl) throw new Error("API URL 未配置");

    const anthropicBase = ensureAbsoluteUrl(profile.baseUrl, "接口地址");
    const url = /\/v1\/messages/i.test(anthropicBase)
      ? anthropicBase
      : `${anthropicBase.replace(/\/+$/, "")}/v1/messages`;

    const payload = withOptionalAnthropicParams(profile, {
      model: profile.model,
      system: SYSTEM_ROLE_PROMPT,
      messages: [
        {
          role: "user",
          content:
            contentMode === "pdf-base64"
              ? [
                  { type: "text", text: summaryPrompt },
                  {
                    type: "document",
                    source: {
                      type: "base64",
                      media_type: "application/pdf",
                      data: content,
                    },
                  },
                ]
              : [{ type: "text", text: buildUserMessage(summaryPrompt, content) }],
        },
      ],
    });

    const headers = {
      "Content-Type": "application/json",
      "x-api-key": profile.apiKey,
      "anthropic-version": "2023-06-01",
      ...(profile.extra?.headers || {}),
    };

    const timeoutMs = getTimeoutMs(profile);
    if (profile.stream && onProgress) {
      const text = await postStream(
        url,
        headers,
        { ...payload, stream: true },
        timeoutMs,
        onProgress,
        parseAnthropicDelta,
      );
      if (text) return text;
    }

    const data = await postJson(url, headers, payload, timeoutMs);
    return extractAnthropicText(data);
  }

  async listModels(profile: ProviderProfile): Promise<LLMModelInfo[]> {
    if (!profile.apiKey) throw new Error("API 密钥未配置");
    const base = ensureAbsoluteUrl(profile.baseUrl, "接口地址")
      .replace(/\/+$/, "")
      .replace(/\/v1(?:\/.*)?$/i, "");
    const data = await getJson(
      `${base}/v1/models`,
      {
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01",
        ...(profile.extra?.headers || {}),
      },
      getTimeoutMs(profile),
    );
    return Array.isArray(data?.data)
      ? data.data
          .map((item: any) => ({
            id: String(item?.id || "").trim(),
            name: item?.display_name ? String(item.display_name) : undefined,
          }))
          .filter((item: LLMModelInfo) => !!item.id)
      : [];
  }

  async testConnection(profile: ProviderProfile): Promise<string> {
    const models = await this.listModels(profile);
    return models.length > 0
      ? `连接成功，共获取到 ${models.length} 个模型`
      : "连接成功，但未获取到模型列表";
  }
}

class GeminiClient implements LLMClient {
  supportsPdfBase64(_profile: ProviderProfile): boolean {
    return true;
  }

  async generateSummary(req: LLMRequest): Promise<string> {
    const { profile, summaryPrompt, content, contentMode, onProgress } = req;
    if (!profile.apiKey) throw new Error("API Key 未配置");
    if (!profile.baseUrl) throw new Error("API URL 未配置");

    const base = ensureAbsoluteUrl(profile.baseUrl, "接口地址")
      .replace(/\/+$/, "")
      .replace(/\/v1beta(?:\/.*)?$/i, "");
    const model = encodeURIComponent(profile.model.replace(/^models\//, ""));
    const streamUrl = `${base}/v1beta/models/${model}:streamGenerateContent?alt=sse`;
    const nonStreamUrl = `${base}/v1beta/models/${model}:generateContent`;

    const payload: any = {
      contents: [
        {
          role: "user",
          parts:
            contentMode === "pdf-base64"
              ? [
                  { text: summaryPrompt },
                  {
                    inlineData: {
                      mimeType: "application/pdf",
                      data: content,
                    },
                  },
                ]
              : [{ text: buildUserMessage(summaryPrompt, content) }],
        },
      ],
      systemInstruction: {
        parts: [{ text: SYSTEM_ROLE_PROMPT }],
      },
      generationConfig: withOptionalGeminiParams(profile, {}),
    };

    const headers = {
      "Content-Type": "application/json",
      "x-goog-api-key": profile.apiKey,
      ...(profile.extra?.headers || {}),
    };

    const timeoutMs = getTimeoutMs(profile);
    if (profile.stream && onProgress) {
      const text = await postStream(
        streamUrl,
        headers,
        payload,
        timeoutMs,
        onProgress,
        (json) => extractGeminiText(json) || null,
      );
      if (text) return text;
    }

    const data = await postJson(nonStreamUrl, headers, payload, timeoutMs);
    return extractGeminiText(data);
  }

  async listModels(profile: ProviderProfile): Promise<LLMModelInfo[]> {
    if (!profile.apiKey) throw new Error("API 密钥未配置");
    const base = ensureAbsoluteUrl(profile.baseUrl, "接口地址")
      .replace(/\/+$/, "")
      .replace(/\/v1beta(?:\/.*)?$/i, "");
    const url = `${base}/v1beta/models?key=${encodeURIComponent(profile.apiKey)}`;
    const data = await getJson(
      url,
      {
        "Content-Type": "application/json",
        ...(profile.extra?.headers || {}),
      },
      getTimeoutMs(profile),
    );
    return Array.isArray(data?.models)
      ? data.models
          .map((item: any) => ({
            id: String(item?.name || "").replace(/^models\//, ""),
            name: item?.displayName ? String(item.displayName) : undefined,
          }))
          .filter((item: LLMModelInfo) => !!item.id)
      : [];
  }

  async testConnection(profile: ProviderProfile): Promise<string> {
    const models = await this.listModels(profile);
    return models.length > 0
      ? `连接成功，共获取到 ${models.length} 个模型`
      : "连接成功，但未获取到模型列表";
  }
}

function getClient(type: ProviderType): LLMClient {
  switch (type) {
    case "openai":
      return new OpenAIClient();
    case "azure":
      return new AzureOpenAIClient();
    case "anthropic":
      return new AnthropicClient();
    case "gemini":
      return new GeminiClient();
    case "deepseek":
      return new DeepSeekClient();
    case "openai_compatible":
    default:
      return new OpenAICompatClient();
  }
}

function getRequestedPdfProcessMode(profile: ProviderProfile): "base64" | "text" | "mineru" {
  return profile.extra?.pdfProcessMode || "base64";
}

function getActiveProfile(): ProviderProfile {
  const profiles = parseProfiles(getPref("profiles"));
  const activeId = String(getPref("activeProfileId") || "").trim();
  if (!profiles.length) throw new Error("请先在设置中创建模型配置");
  const profile = profiles.find((p) => p.id === activeId) || profiles[0];
  if (!profile || !profile.enabled) throw new Error("当前活动模型配置不可用，请在设置中启用或切换配置");
  return normalizeProfile(profile);
}

export class AIService {
  static supportsPdfBase64(profile: ProviderProfile): boolean {
    return getClient(profile.providerType).supportsPdfBase64(profile);
  }

  static resolvePdfProcessMode(profile: ProviderProfile): {
    requested: "base64" | "text" | "mineru";
    actual: "base64" | "text" | "mineru";
    fallbackReason?: string;
  } {
    const requested = getRequestedPdfProcessMode(profile);
    if (requested === "mineru") {
      return {
        requested,
        actual: "text",
        fallbackReason: "MinerU 模式预留中，当前已自动切换为文本模式。",
      };
    }
    if (requested === "base64" && !this.supportsPdfBase64(profile)) {
      return {
        requested,
        actual: "text",
        fallbackReason: "当前接口不支持 PDF Base64 输入，已自动切换为文本模式。",
      };
    }
    return { requested, actual: requested };
  }

  static async generateSummary(
    content: string,
    contentMode: "text" | "pdf-base64" = "text",
    prompt?: string,
    onProgress?: ProgressCb,
  ): Promise<string> {
    const savedPrompt = getPref("summaryPrompt") as string;
    const summaryPrompt =
      prompt ||
      (savedPrompt && savedPrompt.trim()
        ? savedPrompt
        : getDefaultSummaryPrompt());

    const profile = getActiveProfile();

    try {
      const client = getClient(profile.providerType);
      const text = await client.generateSummary({
        content,
        contentMode,
        summaryPrompt,
        profile,
        onProgress,
      });
      return text || "";
    } catch (error: any) {
      const message = safeParseError(error);
      this.notifyError(message);
      throw new Error(message);
    }
  }

  static async listModels(profile: ProviderProfile): Promise<LLMModelInfo[]> {
    const normalized = normalizeProfile(profile);
    try {
      return await getClient(normalized.providerType).listModels(normalized);
    } catch (error: any) {
      const message = safeParseError(error);
      throw new Error(message);
    }
  }

  static async testConnection(profile: ProviderProfile): Promise<string> {
    const normalized = normalizeProfile(profile);
    try {
      return await getClient(normalized.providerType).testConnection(normalized);
    } catch (error: any) {
      const message = safeParseError(error);
      throw new Error(message);
    }
  }

  private static notifyError(message: string) {
    new ztoolkit.ProgressWindow("AiNote", { closeOtherProgressWindows: false })
      .createLine({ text: message, type: "default" })
      .show();
  }
}

export default AIService;
