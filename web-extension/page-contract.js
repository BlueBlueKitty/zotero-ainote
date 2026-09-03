// Generated from src/modules/webSummaryPageContract.ts
"use strict";
var AiNotePageContract = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if ((from && typeof from === "object") || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, {
            get: () => from[key],
            enumerable:
              !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
          });
    }
    return to;
  };
  var __toCommonJS = (mod) =>
    __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../src/modules/webSummaryPageContract.ts
  var webSummaryPageContract_exports = {};
  __export(webSummaryPageContract_exports, {
    captureAssistantBaseline: () => captureAssistantBaseline,
    classifyPage: () => classifyPage,
    evaluateResponseCompletion: () => evaluateResponseCompletion,
    isSupportedChatGPTUrl: () => isSupportedChatGPTUrl,
    isSupportedProjectUrl: () => isSupportedProjectUrl,
    probeAttachment: () => probeAttachment,
    probeResponse: () => probeResponse,
    resolveComposer: () => resolveComposer,
    resolveUploadFilesInput: () => resolveUploadFilesInput,
  });
  var CANONICAL_PROMPT_SELECTOR = "#prompt-textarea";
  var FILE_SELECTORS = ['input[type="file"]'];
  var DOCUMENT_FILE_INPUT_IDS = ["upload-fast-tools-files", "upload-files"];
  var MEDIA_FILE_INPUT_IDS = /* @__PURE__ */ new Set([
    "upload-photos",
    "upload-camera",
    "upload-media-files",
  ]);
  var CANONICAL_SEND_SELECTOR = 'button[data-testid="send-button"]';
  var ASSISTANT_SELECTORS = ['[data-message-author-role="assistant"]'];
  var STOP_SELECTORS = [
    '[data-testid="stop-button"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="\u505C\u6B62"]',
  ];
  function uniqueElements(elements) {
    return elements.filter(
      (element, index) => elements.indexOf(element) === index,
    );
  }
  function fingerprintText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${text.length}:${hash >>> 0}`;
  }
  function queryAll(root, selectors) {
    return uniqueElements(
      selectors.flatMap((selector) =>
        Array.from(root.querySelectorAll(selector)),
      ),
    );
  }
  function summarizeElement(element) {
    const text = String(element.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      tag: element.tagName.toLowerCase(),
      id: String(element.getAttribute("id") || ""),
      testId: String(element.getAttribute("data-testid") || ""),
      role: String(element.getAttribute("role") || ""),
      ariaLabel: String(element.getAttribute("aria-label") || ""),
      title: String(element.getAttribute("title") || ""),
      className: String(element.getAttribute("class") || ""),
      text: text.slice(0, 240),
    };
  }
  function elementDiagnosticText(element) {
    return [
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
    ]
      .map((value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }
  function isUploadErrorElement(element) {
    const testId = String(
      element.getAttribute("data-testid") || "",
    ).toLowerCase();
    if (testId.includes("upload-error") || testId.includes("file-error")) {
      return true;
    }
    if (element.getAttribute("role") !== "alert") return false;
    const text = elementDiagnosticText(element);
    const mentionsUpload = /upload|file|attachment|pdf|上传|文件|附件/.test(
      text,
    );
    const mentionsFailure =
      /error|failed|failure|unable|unsupported|too large|错误|失败|无法|不支持|过大/.test(
        text,
      );
    return mentionsUpload && mentionsFailure;
  }
  function visible(element) {
    if (element.getAttribute("hidden") !== null) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    if (element.getAttribute("inert") !== null) return false;
    const style = element.style;
    if (style?.display === "none" || style?.visibility === "hidden") {
      return false;
    }
    const computed =
      element.ownerDocument?.defaultView?.getComputedStyle?.(element);
    if (
      computed &&
      (computed.display === "none" || computed.visibility === "hidden")
    ) {
      return false;
    }
    for (
      let ancestor = element.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      if (
        ancestor.getAttribute("hidden") !== null ||
        ancestor.getAttribute("aria-hidden") === "true" ||
        ancestor.getAttribute("inert") !== null
      ) {
        return false;
      }
    }
    return true;
  }
  function enabled(button) {
    return !!(
      button &&
      visible(button) &&
      !button.disabled &&
      button.getAttribute("aria-disabled") !== "true" &&
      button.getAttribute("data-testid") !== "stop-button"
    );
  }
  function fileInputId(input) {
    return String(input.getAttribute("id") || "")
      .trim()
      .toLowerCase();
  }
  function fileInputAcceptsPdf(input) {
    const accept = String(input.getAttribute("accept") || "").toLowerCase();
    return accept.includes("pdf") || accept.includes("application/pdf");
  }
  function isMediaFileInput(input) {
    const id = fileInputId(input);
    if (MEDIA_FILE_INPUT_IDS.has(id)) return true;
    if (input.getAttribute("aria-hidden") === "true") return true;
    if (input.getAttribute("capture") !== null) return true;
    const accept = String(input.getAttribute("accept") || "")
      .toLowerCase()
      .trim();
    if (!accept) return false;
    const tokens = accept
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);
    return (
      tokens.length > 0 &&
      tokens.every(
        (token) => token.startsWith("image/") || token.startsWith("video/"),
      )
    );
  }
  function selectFileInputCandidates(fileInputs) {
    for (const id of DOCUMENT_FILE_INPUT_IDS) {
      const preferredDocumentInputs = fileInputs.filter(
        (input) => fileInputId(input) === id,
      );
      if (preferredDocumentInputs.length) {
        return preferredDocumentInputs;
      }
    }
    const pdfFileInputs = fileInputs.filter(fileInputAcceptsPdf);
    if (pdfFileInputs.length) return pdfFileInputs;
    return fileInputs.filter((input) => !isMediaFileInput(input));
  }
  function resolveUploadFilesInput(document) {
    const input = document.querySelector('input[type="file"]#upload-files');
    return input instanceof HTMLInputElement ? input : null;
  }
  function isSupportedChatGPTUrl(value) {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com")
      );
    } catch {
      return false;
    }
  }
  function isProjectPath(pathname) {
    return (
      /^\/g\/g-p-[^/]+\/project(?:\/|$)/i.test(pathname) ||
      /^\/project\/[^/]+(?:\/|$)/i.test(pathname)
    );
  }
  function isSupportedProjectUrl(value) {
    if (!isSupportedChatGPTUrl(value)) return false;
    return isProjectPath(new URL(value).pathname);
  }
  function classifyPage(document, href) {
    if (!isSupportedChatGPTUrl(href)) {
      return { kind: "unknown", reason: "unsupported-origin" };
    }
    const url = new URL(href);
    if (/\/(auth|login)(\/|$)/i.test(url.pathname)) {
      return { kind: "login", reason: "login-path" };
    }
    const challenge = document.querySelector(
      '[data-testid*="captcha"], iframe[src*="captcha"], form[action*="challenge"], [id*="challenge-running"], [data-testid*="security"]',
    );
    if (challenge) {
      return { kind: "human_intervention", reason: "security-challenge" };
    }
    const pageText = String(document.body?.textContent || "").toLowerCase();
    const interventionPhrases = [
      "verify you are human",
      "unusual activity",
      "choose an account",
      "accept terms",
      "\u9A8C\u8BC1\u60A8\u662F\u4EBA\u7C7B",
      "\u9A57\u8B49\u60A8\u662F\u4EBA\u985E",
      "\u5F02\u5E38\u6D3B\u52A8",
      "\u7570\u5E38\u6D3B\u52D5",
      "\u9009\u62E9\u8D26\u6237",
      "\u9078\u64C7\u5E33\u6236",
    ];
    if (interventionPhrases.some((phrase) => pageText.includes(phrase))) {
      return { kind: "human_intervention", reason: "intervention-text" };
    }
    if (/\/c\/[^/]+/i.test(url.pathname)) {
      return { kind: "conversation", reason: "conversation-path" };
    }
    if (isProjectPath(url.pathname)) {
      return { kind: "project", reason: "project-path" };
    }
    if (url.pathname === "/" || url.pathname === "") {
      return { kind: "home", reason: "home-path" };
    }
    return { kind: "unknown", reason: "unrecognized-path" };
  }
  function resolveComposer(document) {
    const promptInput = document.querySelector(CANONICAL_PROMPT_SELECTOR);
    const root = document.body;
    if (!root || !promptInput || !visible(promptInput)) {
      return {
        root: null,
        promptInput: null,
        fileInput: null,
        fileInputDetails: [],
        sendButton: null,
        composerCount: 0,
        promptInputCount: 0,
        fileInputCount: 0,
        sendButtonCount: 0,
        sendEnabled: false,
        ready: false,
        reason: "composer-not-found",
      };
    }
    const fileInputs = queryAll(document, FILE_SELECTORS).filter(
      (element) => element instanceof HTMLInputElement,
    );
    const fileInputDetails = fileInputs.map((input) => ({
      id: fileInputId(input),
      accept: String(input.getAttribute("accept") || ""),
      ariaHidden: String(input.getAttribute("aria-hidden") || ""),
      hidden: Boolean(input.hidden),
      capture: String(input.getAttribute("capture") || ""),
    }));
    const candidateFileInputs = selectFileInputCandidates(fileInputs);
    const sendButtonElement = queryAll(document, [
      CANONICAL_SEND_SELECTOR,
    ]).find(
      (element) => element instanceof HTMLButtonElement && visible(element),
    );
    const sendButton =
      sendButtonElement instanceof HTMLButtonElement ? sendButtonElement : null;
    const resolution = {
      root,
      promptInput,
      fileInput:
        candidateFileInputs.length === 1 ? candidateFileInputs[0] : null,
      fileInputDetails,
      sendButton,
      composerCount: 1,
      promptInputCount: 1,
      fileInputCount: candidateFileInputs.length,
      sendButtonCount: sendButton ? 1 : 0,
      sendEnabled: enabled(sendButton),
      ready: false,
      reason: "ready",
    };
    if (candidateFileInputs.length === 0) {
      resolution.reason = "file-input-not-found";
    } else if (candidateFileInputs.length !== 1) {
      resolution.reason = "ambiguous-file-input";
    } else if (!sendButton) {
      resolution.reason = "send-button-not-found";
    }
    resolution.ready = resolution.reason === "ready";
    return resolution;
  }
  function probeAttachment(composer, fileName, sendButton) {
    const normalizedFileName = fileName.trim().toLowerCase();
    const candidates = Array.from(
      composer.querySelectorAll(
        '[data-testid*="attachment"], [data-testid*="file"], [aria-label], [title]',
      ),
    );
    const attachments = candidates.filter((element) => {
      const values = [
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
      ]
        .map((value) =>
          String(value || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean);
      return values.some(
        (value) =>
          value === normalizedFileName || value.includes(normalizedFileName),
      );
    });
    const attachment = attachments[attachments.length - 1] || null;
    const attachmentHasBusyClass = attachments.some(
      (element) =>
        element instanceof HTMLElement &&
        element.classList.contains("cursor-wait"),
    );
    const busy = !!(
      attachmentHasBusyClass ||
      attachment?.closest('[aria-busy="true"]') ||
      composer.querySelector(
        '[aria-busy="true"], [role="progressbar"], [data-testid*="uploading"]',
      )
    );
    const errorElements = queryAll(composer, [
      '[role="alert"]',
      '[data-testid*="upload-error"]',
      '[data-testid*="file-error"]',
    ]).filter(isUploadErrorElement);
    const error = errorElements.length > 0;
    const sendEnabled = enabled(sendButton);
    const found = !!attachment;
    return {
      found,
      attachmentCount: attachments.length,
      busy,
      error,
      attachmentDetails: attachment ? summarizeElement(attachment) : null,
      errorDetails: errorElements.slice(0, 8).map(summarizeElement),
      sendEnabled,
      ready: found && !busy && !error && sendEnabled,
      reason: !found
        ? "attachment-not-found"
        : busy
          ? "attachment-busy"
          : error
            ? "attachment-error"
            : !sendEnabled
              ? "send-disabled"
              : "ready",
    };
  }
  function captureAssistantBaseline(document) {
    return queryAll(document, ASSISTANT_SELECTORS).length;
  }
  function probeResponse(document, baselineAssistantCount) {
    const assistants = queryAll(document, ASSISTANT_SELECTORS).filter(visible);
    const generating = queryAll(document, STOP_SELECTORS).some(visible);
    const latest = assistants[assistants.length - 1];
    const latestText = String(latest?.textContent || "").trim();
    const latestTextLength = latestText.length;
    const hasNewAssistant = assistants.length > baselineAssistantCount;
    const started = hasNewAssistant || generating;
    return {
      assistantCount: assistants.length,
      hasNewAssistant,
      started,
      generating,
      completed: started && !generating && latestTextLength > 0,
      latestTextLength,
      latestTextFingerprint: fingerprintText(latestText),
    };
  }
  function evaluateResponseCompletion(probe, now, previous, stabilityMs = 3e3) {
    if (probe.generating) {
      return {
        completed: false,
        state: {
          generationObserved: true,
          signature: "",
          stableSince: null,
        },
      };
    }
    if (
      !previous.generationObserved ||
      !probe.hasNewAssistant ||
      probe.latestTextLength === 0
    ) {
      return {
        completed: false,
        state: previous,
      };
    }
    const signature = `${probe.assistantCount}:${probe.latestTextFingerprint}`;
    if (previous.signature !== signature || previous.stableSince === null) {
      return {
        completed: false,
        state: {
          generationObserved: true,
          signature,
          stableSince: now,
        },
      };
    }
    return {
      completed: now - previous.stableSince >= stabilityMs,
      state: previous,
    };
  }
  return __toCommonJS(webSummaryPageContract_exports);
})();
