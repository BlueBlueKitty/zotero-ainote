// @ts-check

(function () {
  if (window.__ainoteContentLoaded) {
    return;
  }
  window.__ainoteContentLoaded = true;

  const DEBUG = true;
  function debugLog(tag, msg, data) {
    if (!DEBUG) return;
    console.log(`[AiNote][Debug][${tag}] ${msg}`, data || "");
  }

  const SELECTORS = {
    promptInput: [
      "#prompt-textarea",
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"]',
      "textarea",
    ],
    fileInput: [
      'input[type="file"]',
      'input[accept*="pdf"]',
      'input[accept*=".pdf"]',
    ],
    sendButton: [
      'button[data-testid="send-button"]',
      "#composer-submit-button:not([data-testid='stop-button'])",
    ],
    stopButton: [
      '[data-testid="stop-button"]',
    ],
    modelPickerButton: [
      'button[aria-haspopup="menu"]',
      'button[aria-haspopup="listbox"]',
    ],
    attachmentButton: [
      'button[aria-label$=".pdf"]',
      '[data-testid*="attachment"]',
      '[data-testid*="file-preview"]',
      '[data-testid*="uploaded-file"]',
    ],
    assistantMessage: [
      '[data-message-author-role="assistant"]',
    ],
  };

  const MODE_LABELS = {
    instant: ["instant", "auto", "fast", "即时", "自动", "快速", "快"],
    thinking: [
      "thinking",
      "think",
      "reasoning",
      "reason",
      "思考",
      "深度思考",
      "推理",
      "进阶",
      "advanced",
      "extended",
      "deep",
      "深度",
    ],
  };

  class TaskCanceledError extends Error {
    constructor(message = "已停止当前条目的AI总结") {
      super(message);
      this.name = "TaskCanceledError";
    }
  }

  function queryFirst(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function queryFirstVisible(selectors) {
    for (const selector of selectors) {
      const node = Array.from(document.querySelectorAll(selector)).find(
        (item) => item instanceof HTMLElement && isVisibleElement(item),
      );
      if (node) return node;
    }
    return null;
  }

  async function waitFor(
    getter,
    timeoutMs = 15000,
    intervalMs = 250,
    name = "page element",
  ) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = await getter();
      if (value) {
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Timeout while waiting for ${name}`);
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "Background request failed"));
          return;
        }
        resolve(response);
      });
    });
  }

  async function reportTaskStatus(taskId, payload) {
    await sendRuntimeMessage({
      type: "ainote-task-status",
      taskId,
      payload,
    });
  }

  const DEFAULT_BRIDGE_URL = "http://127.0.0.1:23123";

  async function getBridgeUrl() {
    const data = await chrome.storage.local.get({ bridgeUrl: DEFAULT_BRIDGE_URL });
    const raw = String(data?.bridgeUrl || DEFAULT_BRIDGE_URL).trim();
    return raw.endsWith("/") ? raw.slice(0, -1) : raw;
  }

  async function fetchTaskPdf(taskId) {
    const bridgeUrl = await getBridgeUrl();
    const url = `${bridgeUrl}/api/ext/tasks/${encodeURIComponent(taskId)}/pdf`;
    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new Error(
        `Bridge 请求失败: GET ${url} - ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new Error(`Bridge 返回错误: GET ${url} - HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async function reportTaskResult(taskId, payload) {
    await sendRuntimeMessage({
      type: "ainote-task-result",
      taskId,
      payload,
    });
  }

  async function reportTaskFailure(taskId, error) {
    await sendRuntimeMessage({
      type: "ainote-task-failure",
      taskId,
      payload: {
        errorCode: "INTERNAL_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
        ...getConversationMeta(),
      },
    });
  }

  async function reportTaskCanceled(taskId, message) {
    await sendRuntimeMessage({
      type: "ainote-task-canceled",
      taskId,
      payload: {
        errorMessage: message || "已停止当前条目的AI总结",
        ...getConversationMeta(),
      },
    });
  }

  async function fetchTaskState(taskId) {
    const response = await sendRuntimeMessage({
      type: "ainote-get-task",
      taskId,
    });
    return response.task;
  }

  function getConversationMeta() {
    const match = location.pathname.match(/\/c\/([^/]+)/);
    return {
      conversationId: match?.[1] || "",
      conversationUrl: location.href,
      conversationTitle: document.title || "",
    };
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isVisibleElement(node) {
    if (!(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  }

  function dispatchPointerMouseClick(node) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    node.focus?.();
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    };
    const pointerInit = {
      ...eventInit,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
    };
    if (typeof PointerEvent === "function") {
      node.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
    }
    node.dispatchEvent(
      new MouseEvent("mousedown", { ...eventInit, button: 0, buttons: 1 }),
    );
    if (typeof PointerEvent === "function") {
      node.dispatchEvent(
        new PointerEvent("pointerup", { ...pointerInit, buttons: 0 }),
      );
    }
    node.dispatchEvent(
      new MouseEvent("mouseup", { ...eventInit, button: 0, buttons: 0 }),
    );
    node.dispatchEvent(
      new MouseEvent("click", { ...eventInit, button: 0, buttons: 0 }),
    );
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
      const fromLocalStorage = localStorage.getItem("oai-device-id");
      if (fromLocalStorage) return fromLocalStorage;
    } catch {
      // ignore
    }
    try {
      const match = document.cookie.match(/oai-did=([^;]+)/);
      if (match?.[1]) return decodeURIComponent(match[1]);
    } catch {
      // ignore
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

  async function ensureTaskActive(taskId) {
    const task = await fetchTaskState(taskId);
    if (!task) {
      throw new TaskCanceledError("网页总结任务不存在，已停止");
    }
    if (task.status === "canceled" || task.cancelRequestedAt) {
      await tryStopGeneration();
      throw new TaskCanceledError(
        task.cancelReason || task.errorMessage || "已停止当前条目的AI总结",
      );
    }
    return task;
  }

  async function tryStopGeneration() {
    const stopButton = queryFirstVisible(SELECTORS.stopButton);
    if (stopButton instanceof HTMLElement) {
      stopButton.click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return true;
    }
    return false;
  }

  async function waitForMutationObserved(options) {
    const {
      checkFn,
      timeoutMs = 30000,
      root = document.body,
      observerConfig = { childList: true, subtree: true },
      debounceMs = 0,
    } = options;

    return new Promise((resolve, reject) => {
      let debounceTimer = null;
      let observer = null;
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        if (debounceTimer) clearTimeout(debounceTimer);
        clearTimeout(mainTimeout);
      };

      const mainTimeout = setTimeout(() => {
        cleanup();
        reject(new Error("Mutation wait timeout"));
      }, timeoutMs);

      const onResult = (success) => {
        if (settled) return;
        cleanup();
        if (success) resolve(success);
      };

      const doCheck = () => {
        if (settled) return;
        const result = checkFn();
        if (result) {
          onResult(result);
        }
      };

      const onMutation = () => {
        if (settled) return;
        if (debounceMs > 0) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(doCheck, debounceMs);
        } else {
          doCheck();
        }
      };

      doCheck();

      observer = new MutationObserver(onMutation);
      try {
        observer.observe(root, observerConfig);
      } catch (e) {
        cleanup();
        reject(e);
      }
    });
  }

  async function applyChatGPTMode(mode) {
    const normalizedMode = mode === "instant" ? "instant" : "thinking";
    const desiredLabels = MODE_LABELS[normalizedMode];

    await waitFor(
      () => queryFirst(SELECTORS.promptInput),
      15000, 250, "prompt input",
    );

    const findPickerButton = () => {
      const buttons = Array.from(
        document.querySelectorAll(SELECTORS.modelPickerButton.join(",")),
      );
      for (const btn of buttons) {
        if (!(btn instanceof HTMLElement)) continue;
        if (!isVisibleElement(btn)) continue;
        const label = normalizeText(btn.textContent || "");
        const hasModeLang = [
          ...MODE_LABELS.instant,
          ...MODE_LABELS.thinking,
        ].some((keyword) => label.includes(keyword));
        if (hasModeLang) return btn;
      }
      return null;
    };

    let pickerButton = await waitFor(
      () => findPickerButton(),
      10000, 200, "ChatGPT model picker button",
    ).catch(() => null);

    if (!pickerButton) {
      debugLog("ModeSwitch", `未找到模型选择器按钮，跳过切换到 ${normalizedMode}`);
      return false;
    }

    const currentText = normalizeText(pickerButton.textContent || "");
    const alreadyOn = desiredLabels.some((l) => currentText.includes(l));
    if (alreadyOn) {
      debugLog("ModeSwitch", `已是 ${normalizedMode} 模式，无需切换`);
      return true;
    }

    debugLog("ModeSwitch", `尝试切换到 ${normalizedMode}，当前按钮文本: "${currentText}"`);

    const findOpenMenu = () => {
      return document.querySelector(
        '[role="menu"][data-state="open"], [role="listbox"][data-state="open"]',
      );
    };

    const findMenuOption = (menuRoot) => {
      if (!menuRoot) return null;
      if (normalizedMode === "thinking") {
        const exactThinking = menuRoot.querySelector(
          '[data-model-picker-thinking-effort-menu-item="true"], [data-testid="model-switcher-gpt-5-5-thinking"]',
        );
        if (exactThinking instanceof HTMLElement && isVisibleElement(exactThinking)) {
          return exactThinking;
        }
      }
      if (normalizedMode === "instant") {
        const exactInstant = menuRoot.querySelector(
          '[data-testid="model-switcher-gpt-5-5"]',
        );
        if (exactInstant instanceof HTMLElement && isVisibleElement(exactInstant)) {
          return exactInstant;
        }
      }
      const options = menuRoot.querySelectorAll(
        '[role="menuitemradio"], [role="menuitem"], [role="option"], button',
      );
      for (const opt of options) {
        if (!(opt instanceof HTMLElement)) continue;
        if (!isVisibleElement(opt)) continue;
        const label = normalizeText(opt.textContent || "");
        const matchesDesired = desiredLabels.some((l) => label.includes(l));
        if (matchesDesired) return opt;
      }
      return null;
    };

    dispatchPointerMouseClick(pickerButton);

    const menuRoot = await waitForMutationObserved({
      checkFn: () => {
        const menu = findOpenMenu();
        return menu instanceof HTMLElement && findMenuOption(menu)
          ? menu
          : null;
      },
      timeoutMs: 3000,
    }).catch(() => null);

    if (!(menuRoot instanceof HTMLElement)) {
      dispatchPointerMouseClick(pickerButton);
      const retryMenu = await waitForMutationObserved({
        checkFn: () => {
          const menu = findOpenMenu();
          return menu instanceof HTMLElement && findMenuOption(menu)
            ? menu
            : null;
        },
        timeoutMs: 3000,
      }).catch(() => null);

      if (!(retryMenu instanceof HTMLElement)) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        console.warn(`[AiNote] 未找到 ChatGPT ${normalizedMode} 模式选项`);
        return false;
      }

      const retryOption = findMenuOption(retryMenu);
      if (!(retryOption instanceof HTMLElement)) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        return false;
      }

      dispatchPointerMouseClick(retryOption);
    } else {
      const option = findMenuOption(menuRoot);
      if (!(option instanceof HTMLElement)) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        return false;
      }
      dispatchPointerMouseClick(option);
    }

    await new Promise((resolve) => setTimeout(resolve, 600));

    const refreshedButton = findPickerButton();
    const refreshedText = normalizeText(
      (refreshedButton instanceof HTMLElement
        ? refreshedButton.textContent
        : "") || "",
    );
    let switchedOk = desiredLabels.some((l) => refreshedText.includes(l));
    const openMenu = document.querySelector(
      '[role="menu"][data-state="open"], [role="listbox"][data-state="open"]',
    );
    if (!switchedOk && openMenu instanceof HTMLElement) {
      const activeOption = openMenu.querySelector(
        '[role="menuitemradio"][aria-checked="true"], [role="option"][aria-selected="true"]',
      );
      if (activeOption instanceof HTMLElement) {
        const activeText = normalizeText(activeOption.textContent || "");
        if (normalizedMode === "thinking") {
          switchedOk =
            activeOption.getAttribute("data-model-picker-thinking-effort-menu-item") === "true" ||
            activeText.includes("thinking");
        } else {
          switchedOk =
            activeOption.getAttribute("data-testid") === "model-switcher-gpt-5-5" ||
            activeText.includes("instant");
        }
      }
    }

    if (!switchedOk) {
      debugLog("ModeSwitch", `切换失败，按钮文本为 "${refreshedText}"`);
      const finalButton = findPickerButton() || pickerButton;
      if (finalButton instanceof HTMLElement) {
        dispatchPointerMouseClick(finalButton);
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      }
      return false;
    }

    debugLog("ModeSwitch", `切换成功 -> ${normalizedMode}`);
    return true;
  }

  async function attachFile(file) {
    const input = await waitFor(
      () => queryFirst(SELECTORS.fileInput),
      15000, 250, "file input",
    );
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("未找到文件上传控件");
    }
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findAttachmentElement(fileName) {
    const normalizedName = normalizeText(fileName);
    const buttons = Array.from(
      document.querySelectorAll(SELECTORS.attachmentButton.join(",")),
    );
    for (const btn of buttons) {
      if (!(btn instanceof HTMLElement) || !isVisibleElement(btn)) continue;
      const ariaLabel = normalizeText(btn.getAttribute("aria-label") || "");
      const title = normalizeText(btn.getAttribute("title") || "");
      if (
        ariaLabel === normalizedName ||
        title === normalizedName ||
        ariaLabel.includes(normalizedName) ||
        normalizedName.includes(ariaLabel) ||
        title.includes(normalizedName)
      ) {
        return btn;
      }
    }
    return null;
  }

  function isAttachmentProcessing(attachmentEl) {
    if (!(attachmentEl instanceof HTMLElement)) {
      return false;
    }
    if (
      attachmentEl.classList.contains("cursor-wait") ||
      attachmentEl.getAttribute("aria-busy") === "true"
    ) {
      return true;
    }
    const busyEl = attachmentEl.querySelector(
      "[role='progressbar'], [aria-busy='true'], .animate-spin, [class*='animate-spin'], [data-testid*='progress']",
    );
    return busyEl instanceof HTMLElement && isVisibleElement(busyEl);
  }

  function isSendButtonEnabled() {
    const sendButton = queryFirstVisible(SELECTORS.sendButton);
    if (!(sendButton instanceof HTMLElement)) return false;
    return (
      !sendButton.hasAttribute("disabled") &&
      sendButton.getAttribute("aria-disabled") !== "true"
    );
  }

  async function waitForAttachmentReady(fileName, taskId) {
    return new Promise((resolve, reject) => {
      let observer = null;
      let taskTimer = null;
      let mainTimeout = null;
      let debounceTimer = null;
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        if (taskTimer) clearInterval(taskTimer);
        if (mainTimeout) clearTimeout(mainTimeout);
        if (debounceTimer) clearTimeout(debounceTimer);
      };

      const finish = () => { cleanup(); resolve(); };
      const fail = (msg) => { cleanup(); reject(new Error(msg)); };

      mainTimeout = setTimeout(
        () => fail("等待 PDF 上传并解析完成超时"),
        3 * 60 * 1000,
      );

      debugLog("PDFUpload", `开始等待上传: ${fileName}`);

      const checkTask = () => {
        ensureTaskActive(taskId).catch((e) => {
          cleanup();
          reject(e);
        });
      };
      checkTask();
      taskTimer = setInterval(checkTask, 3000);

      const checkAttachment = () => {
        if (settled) return;
        const attachmentEl = findAttachmentElement(fileName);
        if (attachmentEl && !isAttachmentProcessing(attachmentEl)) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            const latestAttachment = findAttachmentElement(fileName);
            if (
              latestAttachment &&
              !isAttachmentProcessing(latestAttachment) &&
              isSendButtonEnabled()
            ) {
              finish();
            }
          }, 1500);
        }
      };

      checkAttachment();
      observer = new MutationObserver(checkAttachment);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    });
  }

  async function fillPrompt(prompt) {
    const input = await waitFor(
      () => queryFirst(SELECTORS.promptInput),
      15000, 250, "prompt input",
    );
    if (
      input instanceof HTMLTextAreaElement ||
      input instanceof HTMLInputElement
    ) {
      input.focus();
      input.value = prompt;
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return;
    }
    if (input instanceof HTMLElement) {
      input.focus();
      input.textContent = "";
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      input.textContent = prompt;
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return;
    }
    throw new Error("未找到 Prompt 输入区域");
  }

  async function clickSendButton() {
    let sendButton = null;
    try {
      sendButton = await waitFor(
        () =>
          Array.from(
            document.querySelectorAll(SELECTORS.sendButton.join(",")),
          ).find(
            (node) =>
              node instanceof HTMLElement &&
              isVisibleElement(node) &&
              !node.hasAttribute("disabled") &&
              node.getAttribute("aria-disabled") !== "true",
          ) || null,
        10000, 200, "send button",
      );
    } catch {
      throw new Error("未找到发送按钮");
    }

    if (!(sendButton instanceof HTMLElement)) {
      throw new Error("未找到发送按钮");
    }
    sendButton.click();
    await new Promise((resolve) => setTimeout(resolve, 400));

    if (!queryFirstVisible(SELECTORS.stopButton)) {
      const promptInput = queryFirst(SELECTORS.promptInput);
      if (promptInput instanceof HTMLElement) {
        promptInput.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
        promptInput.dispatchEvent(
          new KeyboardEvent("keyup", { key: "Enter", bubbles: true }),
        );
      }
    }
  }

  async function waitForUserSend(taskId) {
    await reportTaskStatus(taskId, { status: "awaiting_user_send" });

    return new Promise((resolve, reject) => {
      let observer = null;
      let taskTimer = null;
      let mainTimeout = null;
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        if (taskTimer) clearInterval(taskTimer);
        if (mainTimeout) clearTimeout(mainTimeout);
      };

      const finish = () => { cleanup(); resolve(); };
      const fail = (msg) => { cleanup(); reject(new Error(msg)); };

      mainTimeout = setTimeout(
        () => fail("等待用户发送超时"),
        10 * 60 * 1000,
      );

      const checkTask = () => {
        ensureTaskActive(taskId).catch((e) => {
          cleanup();
          reject(e);
        });
      };
      checkTask();
      taskTimer = setInterval(checkTask, 3000);

      const check = () => {
        if (settled) return;
        if (queryFirstVisible(SELECTORS.stopButton)) {
          finish();
          return;
        }
        if (location.pathname.includes("/c/")) {
          finish();
          return;
        }
      };

      check();
      observer = new MutationObserver(check);
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  async function waitForResponseComplete(taskId) {
    await reportTaskStatus(taskId, {
      status: "running",
      ...getConversationMeta(),
    });

    return new Promise((resolve, reject) => {
      let observer = null;
      let taskTimer = null;
      let mainTimeout = null;
      let debounceTimer = null;
      let settled = false;
      const startedAt = Date.now();

      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        if (taskTimer) clearInterval(taskTimer);
        if (mainTimeout) clearTimeout(mainTimeout);
        if (debounceTimer) clearTimeout(debounceTimer);
      };

      const finish = () => { cleanup(); resolve(); };
      const fail = (msg) => { cleanup(); reject(new Error(msg)); };

      mainTimeout = setTimeout(
        () => fail("等待 ChatGPT 响应完成超时"),
        10 * 60 * 1000,
      );

      const checkTask = () => {
        ensureTaskActive(taskId).catch((e) => {
          cleanup();
          reject(e);
        });
      };
      checkTask();
      taskTimer = setInterval(checkTask, 3000);

      let responseHasStarted = false;

      const checkComplete = () => {
        if (settled) return;
        if (Date.now() - startedAt > 10 * 60 * 1000) {
          fail("等待 ChatGPT 响应完成超时");
          return;
        }

        const stopVisible = !!queryFirstVisible(SELECTORS.stopButton);
        const hasConv = !!getConversationMeta().conversationId;

        if (!responseHasStarted) {
          if (stopVisible || hasConv) {
            responseHasStarted = true;
          }
          return;
        }

        if (!stopVisible && hasConv) {
          finish();
        }
      };

      const scheduleCheck = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(checkComplete, 3000);
      };

      checkComplete();
      observer = new MutationObserver(scheduleCheck);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
  }

  async function waitForConversationMetaReady(timeoutMs = 12000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const meta = getConversationMeta();
      if (meta.conversationId && /\/c\//.test(meta.conversationUrl || "")) {
        return meta;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return getConversationMeta();
  }

  function cleanMessageContent(text) {
    if (!text) return "";
    return String(text)
      .replace(/\uE200cite(?:\uE202turn\d+(?:search|view)\d+)+\uE201/gi, "")
      .replace(/cite(?:turn\d+(?:search|view)\d+)+/gi, "")
      .trim();
  }

  function processContentReferences(text, contentReferences) {
    if (!text || !Array.isArray(contentReferences) || contentReferences.length === 0) {
      return { text, footnotes: [] };
    }

    const references = contentReferences.filter(
      (ref) => ref && typeof ref.matched_text === "string" && ref.matched_text.length > 0,
    );
    if (references.length === 0) {
      return { text, footnotes: [] };
    }

    const getReferenceInfo = (ref) => {
      const item = Array.isArray(ref.items) ? ref.items[0] : null;
      const url = item?.url || (Array.isArray(ref.safe_urls) ? ref.safe_urls[0] : "") || "";
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
        const aIdx = Number.isFinite(a.start_idx) ? a.start_idx : Number.MAX_SAFE_INTEGER;
        const bIdx = Number.isFinite(b.start_idx) ? b.start_idx : Number.MAX_SAFE_INTEGER;
        return aIdx - bIdx;
      });

    citationRefs.forEach((ref) => {
      const info = getReferenceInfo(ref);
      if (!info.url) return;
      const key = `${info.url}|${info.title}`;
      if (footnoteIndexByKey.has(key)) return;
      const index = footnotes.length + 1;
      footnoteIndexByKey.set(key, index);
      footnotes.push({ index, url: info.url, title: info.title, label: info.label });
    });

    const sortedByReplacement = references.slice().sort((a, b) => {
      const aIdx = Number.isFinite(a.start_idx) ? a.start_idx : -1;
      const bIdx = Number.isFinite(b.start_idx) ? b.start_idx : -1;
      if (aIdx !== -1 || bIdx !== -1) {
        return bIdx - aIdx;
      }
      return (b.matched_text?.length || 0) - (a.matched_text?.length || 0);
    });

    let output = text;
    sortedByReplacement.forEach((ref) => {
      if (!ref?.matched_text || ref.type === "sources_footnote") return;
      let replacement = "";
      if (ref.type === "grouped_webpages") {
        const info = getReferenceInfo(ref);
        if (info.url) {
          const key = `${info.url}|${info.title}`;
          const index = footnoteIndexByKey.get(key);
          replacement = index ? `([${info.label}][${index}])` : ref.alt || "";
        } else {
          replacement = ref.alt || "";
        }
      } else {
        replacement = ref.alt || "";
      }

      if (Number.isFinite(ref.start_idx) && Number.isFinite(ref.end_idx)) {
        if (output.slice(ref.start_idx, ref.end_idx) === ref.matched_text) {
          output = output.slice(0, ref.start_idx) + replacement + output.slice(ref.end_idx);
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

      const msg = node.message;
      if (msg) {
        const author = msg.author?.role;
        const isHidden =
          msg.metadata?.is_visually_hidden_from_conversation ||
          msg.metadata?.is_contextual_answers_system_message ||
          msg.metadata?.is_system_message;
        if (author && author !== "system" && author !== "tool" && !isHidden) {
          const content = msg.content;
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
            const contentReferences = msg.metadata?.content_references || [];
            let processedText = rawText;
            let footnotes = [];
            if (Array.isArray(contentReferences) && contentReferences.length > 0) {
              const processed = processContentReferences(rawText, contentReferences);
              processedText = processed.text;
              footnotes = processed.footnotes;
            }
            const cleaned = cleanMessageContent(processedText);
            if (cleaned) {
              let finalContent = cleaned;
              if (footnotes.length > 0) {
                const footnoteText = footnotes
                  .slice()
                  .sort((a, b) => a.index - b.index)
                  .map((note) => {
                    if (!note.url) return "";
                    const title = note.title ? ` "${note.title}"` : "";
                    return `[${note.index}]: ${note.url}${title}`;
                  })
                  .filter(Boolean)
                  .join("\n");
                finalContent = cleaned + "\n\n" + footnoteText;
              }
              messages.push({
                role: author,
                content: finalContent,
                create_time: msg.create_time || null,
              });
            }
          }
          if (content?.content_type === "code" && typeof content.text === "string") {
            const cleaned = cleanMessageContent(content.text);
            if (cleaned) {
              messages.push({
                role: author,
                content: cleaned,
                create_time: msg.create_time || null,
              });
            }
          }
          if (typeof content === "string") {
            const cleaned = cleanMessageContent(content);
            if (cleaned) {
              messages.push({
                role: author,
                content: cleaned,
                create_time: msg.create_time || null,
              });
            }
          }
        }
      }

      if (Array.isArray(node.children)) {
        node.children.forEach((childId) => traverse(childId));
      }
    };

    if (rootId) {
      traverse(rootId);
    }
    return messages;
  }

  async function fetchConversationDetail(conversationId) {
    if (!conversationId) {
      return null;
    }
    const token = await getAccessToken();
    const deviceId = getOaiDeviceId();
    if (!token || !deviceId) {
      debugLog("ResultFetch", `API 跳过: token=${!!token}, deviceId=${!!deviceId}`);
      return null;
    }
    const headers = {
      Authorization: `Bearer ${token}`,
      "oai-device-id": deviceId,
    };
    const workspaceId = resolveWorkspaceId();
    if (workspaceId) {
      headers["ChatGPT-Account-Id"] = workspaceId;
    }
    return fetchJson(`/backend-api/conversation/${conversationId}`, {
      headers,
    });
  }

  async function fetchLatestAssistantMarkdownFromConversation() {
    const conversationId = getConversationMeta().conversationId;
    if (!conversationId) {
      return "";
    }
    try {
      const convData = await fetchConversationDetail(conversationId);
      const messages = extractConversationMessages(convData);
      const lastAssistant = [...messages]
        .reverse()
        .find((msg) => msg.role === "assistant");
      const content = lastAssistant?.content || "";
      if (content) {
        debugLog("ResultFetch", `API 获取成功: ${content.length} 字符`);
      } else {
        debugLog("ResultFetch", "API 返回空内容");
      }
      return content;
    } catch (error) {
      debugLog("ResultFetch", `API 获取失败: ${error}`);
      console.warn(
        "[AiNote] Failed to fetch conversation detail for markdown extraction",
        error,
      );
      return "";
    }
  }

  function extractKatexTexFromElement(el) {
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
    const fromSiblingMathMl = el
      .closest(".katex")
      ?.querySelector('annotation[encoding="application/x-tex"]');
    const tex = (annotation?.textContent || fromSiblingMathMl?.textContent || "").trim();
    if (!tex) return null;
    const isDisplay = el.classList.contains("katex-display") || !!el.closest(".katex-display");
    return isDisplay ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
  }

  function domToMarkdown(container) {
    const blockedSelector =
      'sup[data-footnote-id], [type="button"].relative, button.relative, [aria-haspopup="dialog"]';

    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || "";
      }
      if (!(node instanceof HTMLElement)) {
        return "";
      }
      if (node.matches(blockedSelector)) {
        return "";
      }
      if (node.classList.contains("katex") || node.classList.contains("katex-html")) {
        return extractKatexTexFromElement(node) || (node.textContent || "");
      }

      const tag = node.tagName.toLowerCase();
      const inner = Array.from(node.childNodes).map(walk).join("");
      switch (tag) {
        case "h1": return `\n\n# ${inner.trim()}\n\n`;
        case "h2": return `\n\n## ${inner.trim()}\n\n`;
        case "h3": return `\n\n### ${inner.trim()}\n\n`;
        case "h4": return `\n\n#### ${inner.trim()}\n\n`;
        case "h5": return `\n\n##### ${inner.trim()}\n\n`;
        case "h6": return `\n\n###### ${inner.trim()}\n\n`;
        case "p": return `\n\n${inner.trim()}\n\n`;
        case "br": return "\n";
        case "strong":
        case "b": return `**${inner}**`;
        case "em":
        case "i": return `*${inner}*`;
        case "code":
          if (node.parentElement?.tagName.toLowerCase() === "pre") return inner;
          return `\`${inner}\``;
        case "pre": return `\n\n\`\`\`\n${inner.trim()}\n\`\`\`\n\n`;
        case "a": {
          const href = node.getAttribute("href") || "";
          const text = inner.trim() || href;
          return href ? `[${text}](${href})` : text;
        }
        case "li": return `- ${inner.trim()}\n`;
        case "ul":
        case "ol": return `\n${inner}\n`;
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
      SELECTORS.assistantMessage.join(","),
    );
    if (!messages.length) return "";

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!(msg instanceof HTMLElement)) continue;
      if (!isVisibleElement(msg)) continue;

      const markdownContainer = msg.querySelector(
        ".markdown, .prose, [data-testid='conversation-turn-content']",
      );
      if (markdownContainer instanceof HTMLElement) {
        const result = domToMarkdown(markdownContainer);
        if (result) {
          debugLog("ResultFetch", `DOM 获取成功: ${result.length} 字符`);
          return result;
        }
      }
    }

    debugLog("ResultFetch", "DOM 获取失败: 未找到 assistant 消息");
    return "";
  }

  async function runSummarizeTask(message) {
    const task = message.task;
    try {
      await ensureTaskActive(task.taskId);

      await waitFor(
        () => queryFirst(SELECTORS.promptInput),
        30000, 250, "prompt input",
      );

      await reportTaskStatus(task.taskId, {
        status: "creating_conversation",
        ...getConversationMeta(),
      });

      try {
        const modeSwitched = await applyChatGPTMode(
          message.chatgptMode || task.chatgptMode || "thinking",
        );
        if (!modeSwitched) {
          await reportTaskStatus(task.taskId, {
            status: "creating_conversation",
            modeSwitchFailed: true,
            modeSwitchError: "未找到或未成功切换 ChatGPT 模型入口",
            ...getConversationMeta(),
          });
        } else {
          await reportTaskStatus(task.taskId, {
            status: "creating_conversation",
            modeSwitchOk: true,
            debugMessage: "模型切换成功",
            ...getConversationMeta(),
          });
        }
      } catch (error) {
        console.warn(
          "[AiNote] ChatGPT mode switch failed, continue with current mode",
          error,
        );
        await reportTaskStatus(task.taskId, {
          status: "creating_conversation",
          modeSwitchFailed: true,
          modeSwitchError:
            error instanceof Error ? error.message : String(error),
          ...getConversationMeta(),
        });
      }

      await reportTaskStatus(task.taskId, {
        status: "downloading_pdf",
        ...getConversationMeta(),
      });
      const pdfBuffer = await fetchTaskPdf(task.taskId);
      await ensureTaskActive(task.taskId);
      const pdfFile = new File(
        [pdfBuffer],
        task.pdfFileName || "paper.pdf",
        { type: "application/pdf" },
      );
      debugLog("PdfUpload", `开始上传 PDF: ${pdfFile.name}, ${pdfBuffer.byteLength} bytes`);
      await attachFile(pdfFile);
      await waitForAttachmentReady(pdfFile.name, task.taskId);
      await reportTaskStatus(task.taskId, {
        status: "downloading_pdf",
        pdfUploadReady: true,
        debugMessage: `PDF 上传完成: ${pdfFile.name}`,
        ...getConversationMeta(),
      });
      debugLog("PdfUpload", `PDF 上传完成: ${pdfFile.name}`);

      await ensureTaskActive(task.taskId);
      await fillPrompt(task.prompt || "");

      if (message.autoSend) {
        await clickSendButton();
        const metaAfterSend = await waitForConversationMetaReady();
        await reportTaskStatus(task.taskId, {
          status: "running",
          debugMessage: "已点击发送，等待模型完成",
          ...metaAfterSend,
        });
      } else {
        await waitForUserSend(task.taskId);
        const metaAfterSend = await waitForConversationMetaReady();
        await reportTaskStatus(task.taskId, {
          status: "running",
          debugMessage: "用户已发送，等待模型完成",
          ...metaAfterSend,
        });
      }

      await waitForResponseComplete(task.taskId);

      let resultMarkdown = "";
      let resultFetchSource = "none";
      const finalFetchStartedAt = Date.now();
      while (!resultMarkdown && Date.now() - finalFetchStartedAt < 90 * 1000) {
        const apiResult = await fetchLatestAssistantMarkdownFromConversation();
        if (apiResult) {
          resultMarkdown = apiResult;
          resultFetchSource = "API";
          break;
        }
        const domResult = extractLatestAssistantMarkdownFromDom();
        if (domResult) {
          resultMarkdown = domResult;
          resultFetchSource = "DOM";
          break;
        }
        await ensureTaskActive(task.taskId);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      debugLog(
        "ResultFetch",
        `最终来源: ${resultFetchSource}, 长度: ${resultMarkdown.length} 字符`,
      );
      if (!resultMarkdown) {
        throw new Error(
          "未能获取最后一条 assistant 回复（会话 API 与页面提取均失败）",
        );
      }
      return {
        resultMarkdown,
        resultSource: resultFetchSource === "API" ? "api" : resultFetchSource === "DOM" ? "dom" : undefined,
        resultDebugInfo: `fetch-source=${resultFetchSource}; length=${resultMarkdown.length}`,
        ...getConversationMeta(),
      };
    } catch (error) {
      if (error instanceof TaskCanceledError) {
        await reportTaskCanceled(task.taskId, error.message);
      }
      throw error;
    }
  }

  async function openConversationTask(message) {
    const targetUrl = message.task.existingConversationUrl;
    if (!targetUrl) {
      throw new Error("缺少已保存的会话 URL");
    }
    await waitFor(
      () => queryFirst(SELECTORS.promptInput),
      30000, 250, "prompt input",
    );
    const meta = getConversationMeta();
    if (
      message.task.existingConversationId &&
      meta.conversationId &&
      meta.conversationId !== message.task.existingConversationId &&
      !message.recoverRunningTask
    ) {
      throw new Error("当前页面不是预期的历史会话");
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));

    await reportTaskStatus(message.task.taskId, {
      status: "running",
      ...meta,
    });

    let resultMarkdown = "";
    let resultFetchSource = "none";

    try {
      const apiResult = await fetchLatestAssistantMarkdownFromConversation();
      if (apiResult) {
        resultMarkdown = apiResult;
        resultFetchSource = "API";
        debugLog("DebugFetch", `API 获取成功: ${apiResult.length} 字符`);
      }
    } catch (e) {
      debugLog("DebugFetch", `API 获取失败: ${e}`);
    }

    if (!resultMarkdown) {
      const domResult = extractLatestAssistantMarkdownFromDom();
      if (domResult) {
        resultMarkdown = domResult;
        resultFetchSource = "DOM";
        debugLog("DebugFetch", `DOM 获取成功: ${domResult.length} 字符`);
      } else {
        debugLog("DebugFetch", "DOM 获取失败");
      }
    }

    const debugHeader =
      `[Debug 信息]\n` +
      `获取方式: ${resultFetchSource}\n` +
      `会话 ID: ${meta.conversationId || "无"}\n` +
      `内容长度: ${resultMarkdown.length} 字符\n` +
      `获取时间: ${new Date().toISOString()}\n\n`;

    return {
      resultMarkdown: resultMarkdown ? debugHeader + resultMarkdown : "",
      resultSource: resultFetchSource === "API" ? "api" : resultFetchSource === "DOM" ? "dom" : undefined,
      resultDebugInfo: `debug-refetch; fetch-source=${resultFetchSource}; length=${resultMarkdown.length}`,
      ...meta,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ainote-ping") {
      sendResponse({
        ok: true,
        ready: true,
        href: location.href,
        title: document.title || "",
        readyState: document.readyState || "",
      });
      return false;
    }
    if (message?.type === "ainote-run-summarize-task") {
      sendResponse({ ok: true, started: true });
      void runSummarizeTask(message)
        .then((result) => reportTaskResult(message.task.taskId, result))
        .catch((error) => {
          if (error instanceof TaskCanceledError) {
            return;
          }
          reportTaskFailure(message.task.taskId, error).catch((reportErr) => {
            console.error("[AiNote] Failed to report task failure", reportErr);
          });
        });
      return false;
    }
    if (message?.type === "ainote-open-conversation-task") {
      sendResponse({ ok: true, started: true });
      void openConversationTask(message)
        .then((result) =>
          reportTaskResult(message.task.taskId, {
            resultMarkdown: result.resultMarkdown || "",
            resultSource: result.resultSource,
            resultDebugInfo: result.resultDebugInfo,
            ...result,
          }),
        )
        .catch((error) => {
          reportTaskFailure(message.task.taskId, error).catch((reportErr) => {
            console.error("[AiNote] Failed to report task failure", reportErr);
          });
        });
      return false;
    }
    return false;
  });
})();
