// @ts-check

(function installAiNoteResultExtractor() {
  if (globalThis.AiNoteResultExtractor) return;

  function getConversationMeta() {
    const match = location.pathname.match(/\/c\/([^/]+)/);
    return {
      conversationId: match?.[1] || "",
      conversationUrl: location.href,
      conversationTitle: document.title || "",
    };
  }

  async function fetchJson(path, options = {}) {
    const response = await fetch(path, options);
    if (!response.ok) {
      throw new Error(
        `ChatGPT API ${path} failed with HTTP ${response.status}`,
      );
    }
    return response.json();
  }

  function getOaiDeviceId() {
    try {
      const value = localStorage.getItem("oai-device-id");
      if (value) return value;
    } catch {
      // Ignore unavailable storage.
    }
    try {
      const match = document.cookie.match(/oai-did=([^;]+)/);
      if (match?.[1]) return decodeURIComponent(match[1]);
    } catch {
      // Ignore unavailable cookies.
    }
    return "";
  }

  async function getAccessToken() {
    const session = await fetchJson("/api/auth/session?unstable_client=true");
    return session?.accessToken || "";
  }

  function resolveWorkspaceId() {
    const match = document.cookie.match(/(?:^|; )_account=([^;]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  }

  function cleanMessageContent(text) {
    if (!text) return "";
    return String(text)
      .replace(/\uE200cite(?:\uE202turn\d+(?:search|view)\d+)+\uE201/gi, "")
      .replace(/cite(?:turn\d+(?:search|view)\d+)+/gi, "")
      .trim();
  }

  function processContentReferences(text, contentReferences) {
    if (
      !text ||
      !Array.isArray(contentReferences) ||
      contentReferences.length === 0
    ) {
      return { text, footnotes: [] };
    }
    const references = contentReferences.filter(
      (ref) =>
        ref &&
        typeof ref.matched_text === "string" &&
        ref.matched_text.length > 0,
    );
    if (!references.length) return { text, footnotes: [] };

    const getReferenceInfo = (ref) => {
      const item = Array.isArray(ref.items) ? ref.items[0] : null;
      const url =
        item?.url ||
        (Array.isArray(ref.safe_urls) ? ref.safe_urls[0] : "") ||
        "";
      const title = item?.title || "";
      let label = item?.attribution || "";
      if (!label && typeof ref.alt === "string") {
        const match = ref.alt.match(/\[([^\]]+)\]\([^)]+\)/);
        if (match) label = match[1];
      }
      if (!label) label = title || url;
      return { url, title, label };
    };

    const footnotes = [];
    const footnoteIndexByKey = new Map();
    const citationRefs = references
      .filter((ref) => ref.type === "grouped_webpages")
      .sort((a, b) => {
        const aIndex = Number.isFinite(a.start_idx)
          ? a.start_idx
          : Number.MAX_SAFE_INTEGER;
        const bIndex = Number.isFinite(b.start_idx)
          ? b.start_idx
          : Number.MAX_SAFE_INTEGER;
        return aIndex - bIndex;
      });
    citationRefs.forEach((ref) => {
      const info = getReferenceInfo(ref);
      if (!info.url) return;
      const key = `${info.url}|${info.title}`;
      if (footnoteIndexByKey.has(key)) return;
      const index = footnotes.length + 1;
      footnoteIndexByKey.set(key, index);
      footnotes.push({
        index,
        url: info.url,
        title: info.title,
        label: info.label,
      });
    });

    const sortedByReplacement = references.slice().sort((a, b) => {
      const aIndex = Number.isFinite(a.start_idx) ? a.start_idx : -1;
      const bIndex = Number.isFinite(b.start_idx) ? b.start_idx : -1;
      if (aIndex !== -1 || bIndex !== -1) return bIndex - aIndex;
      return (b.matched_text?.length || 0) - (a.matched_text?.length || 0);
    });
    let output = text;
    sortedByReplacement.forEach((ref) => {
      if (!ref?.matched_text || ref.type === "sources_footnote") return;
      let replacement = "";
      if (ref.type === "grouped_webpages") {
        const info = getReferenceInfo(ref);
        if (info.url) {
          const index = footnoteIndexByKey.get(`${info.url}|${info.title}`);
          replacement = index ? `([${info.label}][${index}])` : ref.alt || "";
        } else replacement = ref.alt || "";
      } else replacement = ref.alt || "";

      if (Number.isFinite(ref.start_idx) && Number.isFinite(ref.end_idx)) {
        if (output.slice(ref.start_idx, ref.end_idx) === ref.matched_text) {
          output =
            output.slice(0, ref.start_idx) +
            replacement +
            output.slice(ref.end_idx);
          return;
        }
      }
      output = output.split(ref.matched_text).join(replacement);
    });
    return { text: output, footnotes };
  }

  function extractConversationMessages(convData) {
    const mapping = convData?.mapping;
    if (!mapping) return [];
    const messages = [];
    const mappingKeys = Object.keys(mapping);
    const rootId = mapping["client-created-root"]
      ? "client-created-root"
      : mappingKeys.find((id) => !mapping[id]?.parent) || mappingKeys[0];
    const visited = new Set();
    const traverse = (nodeId) => {
      if (!nodeId || visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = mapping[nodeId];
      if (!node) return;
      const message = node.message;
      if (message) {
        const author = message.author?.role;
        const hidden =
          message.metadata?.is_visually_hidden_from_conversation ||
          message.metadata?.is_contextual_answers_system_message ||
          message.metadata?.is_system_message;
        if (author && author !== "system" && author !== "tool" && !hidden) {
          const content = message.content;
          if (
            content?.content_type === "text" &&
            Array.isArray(content.parts)
          ) {
            const rawText = content.parts
              .map((part) =>
                typeof part === "string" ? part : (part?.text ?? ""),
              )
              .filter(Boolean)
              .join("");
            const processed = processContentReferences(
              rawText,
              message.metadata?.content_references || [],
            );
            const cleaned = cleanMessageContent(processed.text);
            if (cleaned) {
              const footnoteText = processed.footnotes
                .slice()
                .sort((a, b) => a.index - b.index)
                .map((note) =>
                  note.url
                    ? `[${note.index}]: ${note.url}${note.title ? ` "${note.title}"` : ""}`
                    : "",
                )
                .filter(Boolean)
                .join("\n");
              messages.push({
                role: author,
                content: footnoteText
                  ? `${cleaned}\n\n${footnoteText}`
                  : cleaned,
                create_time: message.create_time || null,
              });
            }
          }
          if (
            content?.content_type === "code" &&
            typeof content.text === "string"
          ) {
            const cleaned = cleanMessageContent(content.text);
            if (cleaned) messages.push({ role: author, content: cleaned });
          }
          if (typeof content === "string") {
            const cleaned = cleanMessageContent(content);
            if (cleaned) messages.push({ role: author, content: cleaned });
          }
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(traverse);
    };
    if (rootId) traverse(rootId);
    return messages;
  }

  async function fetchConversationDetail(conversationId) {
    if (!conversationId) return null;
    const token = await getAccessToken();
    const deviceId = getOaiDeviceId();
    if (!token || !deviceId) return null;
    const headers = {
      Authorization: `Bearer ${token}`,
      "oai-device-id": deviceId,
    };
    const workspaceId = resolveWorkspaceId();
    if (workspaceId) headers["ChatGPT-Account-Id"] = workspaceId;
    return fetchJson(`/backend-api/conversation/${conversationId}`, {
      headers,
    });
  }

  async function fetchLatestAssistantMarkdownFromConversation() {
    const conversationId = getConversationMeta().conversationId;
    if (!conversationId) return "";
    try {
      const messages = extractConversationMessages(
        await fetchConversationDetail(conversationId),
      );
      return (
        [...messages].reverse().find((message) => message.role === "assistant")
          ?.content || ""
      );
    } catch {
      return "";
    }
  }

  function visible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  }

  function extractKatexTexFromElement(element) {
    const annotation = element.querySelector(
      'annotation[encoding="application/x-tex"]',
    );
    const sibling = element
      .closest(".katex")
      ?.querySelector('annotation[encoding="application/x-tex"]');
    const tex = (annotation?.textContent || sibling?.textContent || "").trim();
    if (!tex) return null;
    return element.classList.contains("katex-display") ||
      element.closest(".katex-display")
      ? `\n\n$$\n${tex}\n$$\n\n`
      : `$${tex}$`;
  }

  function domToMarkdown(container) {
    const blockedSelector =
      'sup[data-footnote-id], [type="button"].relative, button.relative, [aria-haspopup="dialog"]';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
      if (!(node instanceof HTMLElement) || node.matches(blockedSelector))
        return "";
      if (
        node.classList.contains("katex") ||
        node.classList.contains("katex-html")
      ) {
        return extractKatexTexFromElement(node) || node.textContent || "";
      }
      const tag = node.tagName.toLowerCase();
      const inner = Array.from(node.childNodes).map(walk).join("");
      switch (tag) {
        case "h1":
          return `\n\n# ${inner.trim()}\n\n`;
        case "h2":
          return `\n\n## ${inner.trim()}\n\n`;
        case "h3":
          return `\n\n### ${inner.trim()}\n\n`;
        case "h4":
          return `\n\n#### ${inner.trim()}\n\n`;
        case "h5":
          return `\n\n##### ${inner.trim()}\n\n`;
        case "h6":
          return `\n\n###### ${inner.trim()}\n\n`;
        case "p":
          return `\n\n${inner.trim()}\n\n`;
        case "br":
          return "\n";
        case "strong":
        case "b":
          return `**${inner}**`;
        case "em":
        case "i":
          return `*${inner}*`;
        case "code":
          return node.parentElement?.tagName.toLowerCase() === "pre"
            ? inner
            : `\`${inner}\``;
        case "pre":
          return `\n\n\`\`\`\n${inner.trim()}\n\`\`\`\n\n`;
        case "a": {
          const href = node.getAttribute("href") || "";
          const text = inner.trim() || href;
          return href ? `[${text}](${href})` : text;
        }
        case "li":
          return `- ${inner.trim()}\n`;
        case "ul":
        case "ol":
          return `\n${inner}\n`;
        case "blockquote":
          return inner
            .split("\n")
            .map((line) => (line.trim() ? `> ${line}` : line))
            .join("\n");
        default:
          return inner;
      }
    };
    return walk(container)
      .replace(/\uE200cite(?:\uE202turn\d+(?:search|view)\d+)+\uE201/gi, "")
      .replace(/cite(?:turn\d+(?:search|view)\d+)+/gi, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  function extractLatestAssistantMarkdownFromDom() {
    const messages = document.querySelectorAll(
      '[data-message-author-role="assistant"]',
    );
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!(message instanceof HTMLElement) || !visible(message)) continue;
      const container = message.querySelector(
        ".markdown, .prose, [data-testid='conversation-turn-content']",
      );
      if (container instanceof HTMLElement) {
        const result = domToMarkdown(container);
        if (result) return result;
      }
    }
    return "";
  }

  async function extractFinalResult(
    timeoutMs = 90_000,
    assertActive = async () => {},
  ) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const apiResult = await fetchLatestAssistantMarkdownFromConversation();
      if (apiResult) {
        return { markdown: apiResult, source: "api", ...getConversationMeta() };
      }
      const domResult = extractLatestAssistantMarkdownFromDom();
      if (domResult) {
        return { markdown: domResult, source: "dom", ...getConversationMeta() };
      }
      await assertActive();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(
      "未能获取最后一条 assistant 回复（会话 API 与页面提取均失败）",
    );
  }

  globalThis.AiNoteResultExtractor = {
    getConversationMeta,
    fetchLatestAssistantMarkdownFromConversation,
    extractLatestAssistantMarkdownFromDom,
    extractFinalResult,
  };
})();
