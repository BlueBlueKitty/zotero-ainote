// @ts-check

(function installAiNoteContentAdapter() {
  if (globalThis.__ainoteContentV2Loaded) return;
  globalThis.__ainoteContentV2Loaded = true;

  const contract = /** @type {any} */ (globalThis).AiNotePageContract;
  const extractor = /** @type {any} */ (globalThis).AiNoteResultExtractor;
  const RESPONSE_START_TIMEOUT_MS = 60_000;
  const RESPONSE_STABILITY_TIMEOUT_MS = 3_000;
  const FILE_INPUT_TIMEOUT_MS = 15_000;
  const UPLOAD_COMPOSER_SETTLE_MS = 2_000;
  const ATTACHMENT_OBSERVATION_TIMEOUT_MS = 180_000;
  const SEND_READY_TIMEOUT_MS = 30_000;
  let contentLogLevel = "error";

  function normalizeContentLogLevel(value) {
    const text = String(value || "")
      .trim()
      .toLowerCase();
    return text === "off" || text === "debug" ? text : "error";
  }

  async function refreshContentLogLevel() {
    try {
      const settings = await chrome.storage.local.get({ logLevel: "error" });
      contentLogLevel = normalizeContentLogLevel(settings.logLevel);
    } catch {
      contentLogLevel = "error";
    }
  }

  function formatContentLogDetails(details) {
    if (details instanceof Error) {
      return details.stack || details.message;
    }
    try {
      const serialized = JSON.stringify(details);
      return serialized === undefined ? String(details) : serialized;
    } catch {
      return String(details);
    }
  }

  function emitContentLog(level, scope, message, details) {
    if (
      contentLogLevel === "off" ||
      (level === "debug" && contentLogLevel !== "debug")
    ) {
      return;
    }
    const prefix = `[AiNote][WebSummary${level === "debug" ? "Debug" : "Error"}][${scope}] ${message}`;
    const output =
      details === undefined
        ? prefix
        : `${prefix} ${formatContentLogDetails(details)}`;
    if (level === "debug") {
      console.log(output);
    } else {
      console.error(output);
    }
    void chrome.runtime
      .sendMessage({
        type: "ainote-debug-log",
        level,
        scope,
        message,
        details,
      })
      .catch(() => {});
  }

  function debugLog(scope, message, details) {
    emitContentLog("debug", scope, message, details);
  }

  function installUploadEventTrace() {
    if (globalThis.__ainoteUploadEventTraceInstalled) return;
    globalThis.__ainoteUploadEventTraceInstalled = true;
    for (const eventName of ["input", "change"]) {
      document.addEventListener(
        eventName,
        (event) => {
          const element = event.target;
          if (
            !(element instanceof HTMLInputElement) ||
            element.type !== "file"
          ) {
            return;
          }
          debugLog("UploadTrace", `page ${eventName} event observed`, {
            id: element.id,
            accept: element.accept,
            files: element.files?.length || 0,
            fileNames: Array.from(element.files || []).map((file) => file.name),
            isTrusted: event.isTrusted,
            defaultPrevented: event.defaultPrevented,
          });
        },
        true,
      );
    }
  }

  installUploadEventTrace();

  function errorLog(scope, message, details) {
    emitContentLog("error", scope, message, details);
  }

  function createDebugStateLogger(scope, message) {
    let previous = "";
    return (details) => {
      const signature = formatContentLogDetails(details);
      if (signature === previous) return;
      previous = signature;
      debugLog(scope, message, details);
    };
  }

  function summarizeElement(element) {
    if (!(element instanceof Element)) return null;
    return {
      tag: element.tagName.toLowerCase(),
      id: element.getAttribute("id") || "",
      testId: element.getAttribute("data-testid") || "",
      role: element.getAttribute("role") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      title: element.getAttribute("title") || "",
      hidden: element.hasAttribute("hidden"),
      disabled: element instanceof HTMLButtonElement ? element.disabled : false,
      className: String(element.className || ""),
    };
  }

  function summarizeComposer(resolution) {
    return {
      reason: resolution?.reason || "",
      ready: Boolean(resolution?.ready),
      prompt: summarizeElement(resolution?.promptInput),
      promptInputCount: resolution?.promptInputCount || 0,
      fileInput: summarizeElement(resolution?.fileInput),
      fileInputCount: resolution?.fileInputCount || 0,
      fileInputs: resolution?.fileInputDetails || [],
      sendButton: summarizeElement(resolution?.sendButton),
      sendButtonCount: resolution?.sendButtonCount || 0,
      sendEnabled: Boolean(resolution?.sendEnabled),
    };
  }

  class PageAdapterError extends Error {
    constructor(message, code, sendState = "not_sent", details = undefined) {
      super(message);
      this.name = "PageAdapterError";
      this.code = code;
      this.sendState = sendState;
      this.details = details;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForMutation(check, timeoutMs, timeoutMessage, onPoll = null) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let observer = null;
      let pollTimer = null;
      let pollInFlight = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        if (pollTimer) clearInterval(pollTimer);
        clearTimeout(timer);
        callback();
      };
      const inspect = () => {
        try {
          const value = check();
          if (value) finish(() => resolve(value));
        } catch (error) {
          finish(() => reject(error));
        }
      };
      const timer = setTimeout(() => {
        finish(() => {
          const timeoutValue =
            typeof timeoutMessage === "function"
              ? timeoutMessage()
              : timeoutMessage;
          const error =
            timeoutValue instanceof Error
              ? timeoutValue
              : new Error(String(timeoutValue));
          debugLog("Wait", "condition timed out", {
            message: error.message,
            timeoutMs,
          });
          reject(error);
        });
      }, timeoutMs);
      observer = new MutationObserver(inspect);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      if (onPoll) {
        pollTimer = setInterval(() => {
          if (settled || pollInFlight) return;
          pollInFlight = true;
          Promise.resolve()
            .then(() => onPoll())
            .then(() => inspect())
            .catch((error) => finish(() => reject(error)))
            .finally(() => {
              pollInFlight = false;
            });
        }, 1_000);
      }
      inspect();
    });
  }

  function assertRuntimeReady() {
    if (!contract || !extractor) {
      throw new PageAdapterError(
        "AiNote 页面适配器未完整加载",
        "PAGE_CONTRACT_UNAVAILABLE",
      );
    }
  }

  function assertUsablePage() {
    const page = contract.classifyPage(document, location.href);
    if (page.kind === "login") {
      throw new PageAdapterError("ChatGPT 尚未登录", "LOGIN_REQUIRED");
    }
    if (page.kind === "human_intervention") {
      throw new PageAdapterError(
        "ChatGPT 页面需要用户完成验证或账户选择",
        "HUMAN_INTERVENTION_REQUIRED",
      );
    }
    if (!["project", "conversation", "home"].includes(page.kind)) {
      throw new PageAdapterError(
        `无法识别 ChatGPT 页面（${page.reason}）`,
        "PAGE_CONTRACT_UNAVAILABLE",
      );
    }
    return page;
  }

  function base64ToFile(base64, fileName) {
    const bytes = atob(base64);
    const data = new Uint8Array(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
      data[index] = bytes.charCodeAt(index);
    }
    return new File([data], fileName, { type: "application/pdf" });
  }

  function setPromptValue(input, prompt) {
    input.focus();
    if (
      input instanceof HTMLTextAreaElement ||
      input instanceof HTMLInputElement
    ) {
      const proto =
        input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter?.call(input, prompt);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    input.textContent = prompt;
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: prompt,
      }),
    );
  }

  function promptIsPresent(input, prompt) {
    const current =
      input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement
        ? input.value
        : input.textContent;
    return String(current || "").trim() === prompt.trim();
  }

  async function reportStage(taskId, stage, conversationMeta = {}) {
    debugLog("Task", "stage requested", { taskId, stage, conversationMeta });
    const response = await chrome.runtime.sendMessage({
      type: "ainote-task-stage",
      taskId,
      stage,
      conversationMeta,
    });
    if (!response?.ok) {
      throw new PageAdapterError(
        response?.error || "任务租约已失效",
        response?.code || "LEASE_INVALID",
        stage === "prompt_sent" ||
        stage === "waiting_response" ||
        stage === "extracting_result"
          ? "sent"
          : "not_sent",
      );
    }
  }

  async function assertTaskActive(taskId) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "ainote-task-assert-active",
        taskId,
      });
      if (response?.ok) return;
      throw new PageAdapterError(
        response?.error || "任务已取消或执行上下文已失效",
        response?.code || "TARGET_PAGE_UNAVAILABLE",
        "not_sent",
      );
    } catch (error) {
      if (error instanceof PageAdapterError) throw error;
      throw new PageAdapterError(
        error instanceof Error ? error.message : String(error),
        "TARGET_PAGE_UNAVAILABLE",
        "not_sent",
      );
    }
  }

  function formatComposerFileInputs(resolution) {
    const details = Array.isArray(resolution?.fileInputDetails)
      ? resolution.fileInputDetails
      : [];
    if (!details.length) return "none";
    return details
      .map((input) => {
        const id = input.id || "-";
        const accept = input.accept || "-";
        const ariaHidden = input.ariaHidden || "-";
        const hidden = input.hidden ? "1" : "0";
        const capture = input.capture || "-";
        return `${id}[accept=${accept};aria-hidden=${ariaHidden};hidden=${hidden};capture=${capture}]`;
      })
      .join(",");
  }

  function currentConversationMeta() {
    return extractor.getConversationMeta();
  }

  async function waitForComposer(activeCheck) {
    let lastResolution = null;
    const logResolution = createDebugStateLogger("Composer", "resolution");
    return waitForMutation(
      () => {
        const resolution = contract.resolveComposer(document);
        lastResolution = resolution;
        logResolution(summarizeComposer(resolution));
        if (resolution.reason.startsWith("ambiguous")) {
          throw new PageAdapterError(
            `ChatGPT 编辑器结构不唯一（${resolution.reason}; file-inputs=${formatComposerFileInputs(resolution)}）`,
            "PAGE_CONTRACT_UNAVAILABLE",
          );
        }
        // ChatGPT can render the voice-input control here before it renders
        // the send button. The send button is enabled only after the prompt
        // and/or attachment has been accepted, so requiring it at this stage
        // would deadlock the preparation flow.
        if (resolution.promptInput) return resolution;
        return null;
      },
      30_000,
      () =>
        `等待 ChatGPT 编辑器超时（reason=${lastResolution?.reason || "unknown"}; file-inputs=${formatComposerFileInputs(lastResolution || {})}; send-button=${lastResolution?.sendButton ? "found" : "missing"}）`,
      activeCheck,
    );
  }

  async function uploadPdf(
    composer,
    base64,
    fileName,
    activeCheck,
    onUploadObserved,
  ) {
    const file = base64ToFile(base64, fileName);
    debugLog("Upload", "file prepared", {
      fileName,
      size: file.size,
      type: file.type,
    });
    const fileInput = await waitForMutation(
      () => contract.resolveUploadFilesInput(document),
      FILE_INPUT_TIMEOUT_MS,
      "等待 ChatGPT #upload-files 文件上传控件超时",
      activeCheck,
    );
    debugLog("Upload", "file input selected", {
      fileName,
      input: summarizeElement(fileInput),
      connected: fileInput.isConnected,
      disabled: fileInput.disabled,
      multiple: fileInput.multiple,
      filesBefore: fileInput.files?.length || 0,
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    debugLog("Upload", "file input files assigned", {
      fileName,
      filesAfterAssignment: fileInput.files?.length || 0,
      fileNamesAfterAssignment: Array.from(fileInput.files || []).map(
        (item) => item.name,
      ),
      assignedSize: fileInput.files?.[0]?.size || 0,
      assignedType: fileInput.files?.[0]?.type || "",
    });
    const inputEvent = new Event("input", { bubbles: true });
    const inputDispatchResult = fileInput.dispatchEvent(inputEvent);
    debugLog("Upload", "input event dispatched", {
      fileName,
      dispatchResult: inputDispatchResult,
      filesAfterInput: fileInput.files?.length || 0,
      isTrusted: inputEvent.isTrusted,
    });
    const changeEvent = new Event("change", { bubbles: true });
    const changeDispatchResult = fileInput.dispatchEvent(changeEvent);
    debugLog("Upload", "change event dispatched", {
      fileName,
      dispatchResult: changeDispatchResult,
      filesAfterChange: fileInput.files?.length || 0,
      isTrusted: changeEvent.isTrusted,
    });
    const logProbe = createDebugStateLogger("Upload", "attachment probe");
    let uploadStagePromise = null;
    const markUploadObserved = () => {
      if (!uploadStagePromise && onUploadObserved) {
        uploadStagePromise = Promise.resolve().then(() => onUploadObserved());
      }
    };
    const deadline = Date.now() + ATTACHMENT_OBSERVATION_TIMEOUT_MS;
    let attachmentEverFound = false;
    let lastProbe = null;
    const createUploadTimeoutError = () => {
      const code = !attachmentEverFound
        ? "UPLOAD_NOT_OBSERVED"
        : lastProbe?.busy
          ? "UPLOAD_STUCK"
          : "ATTACHMENT_NOT_READY";
      const message =
        code === "UPLOAD_NOT_OBSERVED"
          ? "文件事件已派发，但 ChatGPT 未出现 PDF 附件控件，无法确认上传已开始"
          : code === "UPLOAD_STUCK"
            ? "ChatGPT 已出现 PDF 附件控件，但上传状态在限定时间内未完成"
            : "ChatGPT 已出现 PDF 附件控件，但附件在限定时间内仍不可发送";
      return new PageAdapterError(message, code, "not_sent", {
        stage: "uploading_pdf",
        fileName,
        attachmentEverFound,
        lastProbe,
        composer: summarizeComposer(contract.resolveComposer(document)),
      });
    };
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw createUploadTimeoutError();
      }
      const candidate = await waitForMutation(
        () => {
          const currentComposer = contract.resolveComposer(document);
          const probe = contract.probeAttachment(
            currentComposer.root || composer.root,
            fileName,
            currentComposer.sendButton,
          );
          logProbe({
            fileName,
            ...probe,
            composer: summarizeComposer(currentComposer),
          });
          lastProbe = probe;
          if (probe.found) {
            attachmentEverFound = true;
            markUploadObserved();
          }
          if (probe.error && !probe.busy) {
            throw new PageAdapterError(
              "ChatGPT 报告 PDF 上传失败",
              "UPLOAD_FAILED",
              "not_sent",
              {
                stage: "uploading_pdf",
                fileName,
                probe,
                composer: summarizeComposer(currentComposer),
              },
            );
          }
          return probe.ready ? { currentComposer, probe } : null;
        },
        remaining,
        createUploadTimeoutError,
        activeCheck,
      );

      // ChatGPT may briefly render a complete-looking attachment while its
      // upload state is still being reconciled. Require the ready state to
      // remain valid across a second DOM read before sending the prompt.
      await sleep(500);
      const settledComposer = contract.resolveComposer(document);
      const settledProbe = contract.probeAttachment(
        settledComposer.root || candidate.currentComposer.root || composer.root,
        fileName,
        settledComposer.sendButton,
      );
      logProbe({
        fileName,
        ...settledProbe,
        stabilityCheck: true,
        composer: summarizeComposer(settledComposer),
      });
      lastProbe = settledProbe;
      if (settledProbe.found) {
        attachmentEverFound = true;
        markUploadObserved();
      }
      if (settledProbe.error && !settledProbe.busy) {
        throw new PageAdapterError(
          "ChatGPT 报告 PDF 上传失败",
          "UPLOAD_FAILED",
          "not_sent",
          {
            stage: "uploading_pdf",
            fileName,
            probe: settledProbe,
            composer: summarizeComposer(settledComposer),
          },
        );
      }
      if (settledProbe.ready) {
        await uploadStagePromise;
        return settledProbe;
      }
    }
  }

  async function waitForUploadComposer(activeCheck) {
    let stablePrompt = null;
    let stableRoot = null;
    let stableFileInput = null;
    let stableSince = null;
    const logReadiness = createDebugStateLogger("Composer", "upload readiness");
    return waitForMutation(
      () => {
        const resolution = contract.resolveComposer(document);
        const fileInput = contract.resolveUploadFilesInput(document);
        const structurallyReady = Boolean(
          document.readyState === "complete" &&
            resolution.promptInput?.isConnected &&
            fileInput?.isConnected &&
            !fileInput.disabled &&
            resolution.root?.contains(fileInput),
        );
        if (!structurallyReady) {
          stablePrompt = null;
          stableRoot = null;
          stableFileInput = null;
          stableSince = null;
          logReadiness({
            ready: false,
            documentReadyState: document.readyState,
            promptConnected: Boolean(resolution.promptInput?.isConnected),
            fileInputConnected: Boolean(fileInput?.isConnected),
            fileInputDisabled: Boolean(fileInput?.disabled),
            composer: summarizeComposer(resolution),
          });
          return null;
        }

        const sameElements =
          stablePrompt === resolution.promptInput &&
          stableRoot === resolution.root &&
          stableFileInput === fileInput;
        if (!sameElements) {
          stablePrompt = resolution.promptInput;
          stableRoot = resolution.root;
          stableFileInput = fileInput;
          stableSince = Date.now();
          logReadiness({
            ready: false,
            reason: "stabilizing",
            documentReadyState: document.readyState,
            composer: summarizeComposer(resolution),
          });
          return null;
        }

        const stableForMs = Date.now() - (stableSince || Date.now());
        const ready = stableForMs >= UPLOAD_COMPOSER_SETTLE_MS;
        logReadiness({
          ready,
          reason: ready ? "stable" : "stabilizing",
          documentReadyState: document.readyState,
          stableForMs,
          composer: summarizeComposer(resolution),
        });
        return ready ? resolution : null;
      },
      FILE_INPUT_TIMEOUT_MS,
      "等待 ChatGPT 编辑器和文件上传控件初始化超时",
      activeCheck,
    );
  }

  async function waitForPromptAccepted(input, prompt, baseline, activeCheck) {
    return waitForMutation(
      () => {
        const response = contract.probeResponse(document, baseline);
        return response.started || !promptIsPresent(input, prompt)
          ? response
          : null;
      },
      15_000,
      "点击发送后未检测到新消息",
      activeCheck,
    );
  }

  async function waitForResponse(baseline, totalTimeoutMs, activeCheck) {
    await waitForMutation(
      () => {
        const probe = contract.probeResponse(document, baseline);
        return probe.started ? probe : null;
      },
      Math.min(RESPONSE_START_TIMEOUT_MS, totalTimeoutMs),
      "ChatGPT 在 60 秒内未开始回复",
      activeCheck,
    );
    let stabilityState = {
      generationObserved: false,
      signature: "",
      stableSince: null,
    };
    await waitForMutation(
      () => {
        const probe = contract.probeResponse(document, baseline);
        const completion = contract.evaluateResponseCompletion(
          probe,
          Date.now(),
          stabilityState,
          RESPONSE_STABILITY_TIMEOUT_MS,
        );
        stabilityState = completion.state;
        debugLog("Response", "completion stability check", {
          ...probe,
          generationObserved: stabilityState.generationObserved,
          stableSince: stabilityState.stableSince,
          completed: completion.completed,
        });
        return completion.completed ? probe : null;
      },
      totalTimeoutMs,
      "等待 ChatGPT 完成回复超时",
      activeCheck,
    );
  }

  async function runSummary(task, pdfBase64) {
    await refreshContentLogLevel();
    debugLog("Task", "summary started", {
      pdfFileName: task?.pdfFileName || "",
      promptLength: String(task?.prompt || "").length,
      pageUrl: location.href,
    });
    assertRuntimeReady();
    assertUsablePage();
    if (!task?.prompt || !task?.pdfFileName || !pdfBase64) {
      throw new PageAdapterError("总结任务缺少提示词或 PDF", "INVALID_REQUEST");
    }
    const activeCheck = () => assertTaskActive(task.taskId);
    await reportStage(task.taskId, "preparing_page", currentConversationMeta());
    const composer = await waitForComposer(activeCheck);
    debugLog("Composer", "initial composer ready", summarizeComposer(composer));
    const uploadReadyComposer = await waitForUploadComposer(activeCheck);
    await uploadPdf(
      uploadReadyComposer,
      pdfBase64,
      task.pdfFileName,
      activeCheck,
      () =>
        reportStage(task.taskId, "uploading_pdf", currentConversationMeta()),
    );
    await reportStage(task.taskId, "ready_to_send", currentConversationMeta());

    const promptComposer = await waitForMutation(
      () => {
        const resolution = contract.resolveComposer(document);
        if (resolution.reason.startsWith("ambiguous")) {
          throw new PageAdapterError(
            `ChatGPT 编辑器结构不唯一（${resolution.reason}; file-inputs=${formatComposerFileInputs(resolution)}）`,
            "PAGE_CONTRACT_UNAVAILABLE",
          );
        }
        return resolution.promptInput ? resolution : null;
      },
      30_000,
      "等待 ChatGPT 编辑器准备输入提示词超时",
      activeCheck,
    );
    debugLog("Composer", "prompt composer ready", {
      composer: summarizeComposer(promptComposer),
    });
    const baseline = contract.captureAssistantBaseline(document);
    setPromptValue(promptComposer.promptInput, task.prompt);
    debugLog("Composer", "prompt value set", {
      promptLength: task.prompt.length,
      promptPresent: promptIsPresent(promptComposer.promptInput, task.prompt),
    });
    if (!promptIsPresent(promptComposer.promptInput, task.prompt)) {
      throw new PageAdapterError(
        "无法可靠写入 ChatGPT 提示词",
        "PAGE_CONTRACT_UNAVAILABLE",
      );
    }

    const refreshed = await waitForMutation(
      () => {
        const resolution = contract.resolveComposer(document);
        debugLog(
          "Composer",
          "send readiness check",
          summarizeComposer(resolution),
        );
        if (resolution.reason.startsWith("ambiguous")) {
          throw new PageAdapterError(
            `ChatGPT 编辑器结构不唯一（${resolution.reason}; file-inputs=${formatComposerFileInputs(resolution)}）`,
            "PAGE_CONTRACT_UNAVAILABLE",
          );
        }
        return resolution.ready && resolution.sendEnabled ? resolution : null;
      },
      SEND_READY_TIMEOUT_MS,
      "等待 ChatGPT 发送按钮可用超时",
      activeCheck,
    );
    debugLog("Composer", "send button ready", summarizeComposer(refreshed));
    refreshed.sendButton.click();
    await waitForPromptAccepted(
      refreshed.promptInput,
      task.prompt,
      baseline,
      activeCheck,
    );
    await reportStage(task.taskId, "prompt_sent", currentConversationMeta());
    await reportStage(
      task.taskId,
      "waiting_response",
      currentConversationMeta(),
    );
    const totalTimeoutMs = Math.max(
      5 * 60_000,
      Number(task.responseTimeoutMs) || 15 * 60_000,
    );
    await waitForResponse(baseline, totalTimeoutMs, activeCheck);
    await reportStage(
      task.taskId,
      "extracting_result",
      currentConversationMeta(),
    );
    const result = await extractor.extractFinalResult(90_000, async () => {
      const active = await chrome.runtime.sendMessage({
        type: "ainote-task-assert-active",
        taskId: task.taskId,
      });
      if (!active?.ok) {
        throw new PageAdapterError(
          active?.error || "任务租约已失效",
          active?.code || "LEASE_INVALID",
          "sent",
        );
      }
      await sleep(0);
    });
    return { ok: true, result };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ainote-ping") {
      sendResponse({ ok: true, version: 2 });
      return false;
    }
    if (message?.type !== "ainote-run-summary") return false;
    void runSummary(message.task, message.pdfBase64)
      .then(sendResponse)
      .catch((error) => {
        const response = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          code: error?.code || "PAGE_OPERATION_FAILED",
          sendState: error?.sendState || "unknown",
          debugInfo: error?.details,
          conversationMeta: currentConversationMeta(),
        };
        errorLog("Task", "summary failed", {
          ...response,
          stack: error instanceof Error ? error.stack : undefined,
        });
        sendResponse(response);
      });
    return true;
  });
})();
