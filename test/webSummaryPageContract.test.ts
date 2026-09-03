import { assert } from "chai";
import {
  captureAssistantBaseline,
  classifyPage,
  evaluateResponseCompletion,
  isSupportedProjectUrl,
  probeAttachment,
  probeResponse,
  resolveComposer,
  resolveUploadFilesInput,
} from "../src/modules/webSummaryPageContract";

function fixture(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("webSummaryPageContract", function () {
  it("accepts project URLs and rejects ordinary ChatGPT pages", function () {
    assert.isTrue(
      isSupportedProjectUrl("https://chatgpt.com/g/g-p-project123/project"),
    );
    assert.isTrue(
      isSupportedProjectUrl("https://chatgpt.com/project/project123"),
    );
    assert.isFalse(
      isSupportedProjectUrl("https://chatgpt.com/c/conversation123"),
    );
    assert.isFalse(isSupportedProjectUrl("https://example.com/project/123"));
  });

  it("classifies project, conversation, login and security pages", function () {
    const blank = fixture("<body></body>");
    assert.equal(
      classifyPage(blank, "https://chatgpt.com/g/g-p-demo/project").kind,
      "project",
    );
    assert.equal(
      classifyPage(blank, "https://chatgpt.com/c/conversation-id").kind,
      "conversation",
    );
    assert.equal(
      classifyPage(blank, "https://chatgpt.com/auth/login").kind,
      "login",
    );
    const challenge = fixture(
      '<body><iframe src="/captcha/frame"></iframe></body>',
    );
    assert.equal(
      classifyPage(challenge, "https://chatgpt.com/").kind,
      "human_intervention",
    );
  });

  it("resolves exactly one verified composer", function () {
    const doc = fixture(`
      <body>
        <form data-testid="composer">
          <textarea id="prompt-textarea" placeholder="Message"></textarea>
          <input type="file" accept="application/pdf" />
          <button data-testid="send-button">Send</button>
        </form>
      </body>
    `);
    const composer = resolveComposer(doc);
    assert.isTrue(composer.ready);
    assert.equal(composer.promptInputCount, 1);
    assert.equal(composer.fileInputCount, 1);
    assert.equal(composer.sendButtonCount, 1);
  });

  it("prefers the PDF file input when ChatGPT exposes another file input", function () {
    const doc = fixture(`
      <body>
        <form data-testid="composer">
          <textarea id="prompt-textarea" placeholder="Message"></textarea>
          <input type="file" accept="image/*" />
          <input type="file" accept="application/pdf,.pdf" />
          <button data-testid="send-button">Send</button>
        </form>
      </body>
    `);
    const composer = resolveComposer(doc);
    assert.isTrue(composer.ready);
    assert.equal(
      composer.fileInput?.getAttribute("accept"),
      "application/pdf,.pdf",
    );
    assert.equal(composer.fileInputCount, 1);
  });

  it("scopes the composer before counting file inputs in an outer form", function () {
    const doc = fixture(`
      <body>
        <form>
          <input type="file" accept="application/pdf" data-testid="outer-upload" />
          <div data-testid="composer">
            <textarea id="prompt-textarea" placeholder="Message"></textarea>
            <input type="file" accept="application/pdf" data-testid="composer-upload" />
            <button data-testid="send-button">Send</button>
          </div>
        </form>
      </body>
    `);
    const composer = resolveComposer(doc);
    assert.isTrue(composer.ready);
    assert.equal(composer.fileInputCount, 1);
    assert.equal(
      composer.fileInput?.getAttribute("data-testid"),
      "composer-upload",
    );
  });

  it("selects the document input when photo and camera inputs are mounted", function () {
    const doc = fixture(`
      <body>
        <form data-type="unified-composer">
          <input multiple tabindex="-1" id="upload-files" type="file" />
          <input
            multiple
            tabindex="-1"
            aria-hidden="true"
            id="upload-photos"
            data-testid="upload-photos-input"
            accept="image/*"
            type="file"
          />
          <input
            multiple
            tabindex="-1"
            aria-hidden="true"
            id="upload-camera"
            accept="image/*"
            capture="environment"
            type="file"
          />
          <div
            contenteditable="true"
            id="prompt-textarea"
            role="textbox"
            aria-multiline="true"
          ></div>
          <button data-testid="send-button">Send</button>
        </form>
      </body>
    `);
    const composer = resolveComposer(doc);
    assert.isTrue(composer.ready);
    assert.equal(composer.fileInputCount, 1);
    assert.equal(composer.fileInput?.getAttribute("id"), "upload-files");
  });

  it("prefers the fast-tools document input when it is mounted", function () {
    const doc = fixture(`
      <body>
        <form data-type="unified-composer">
          <input id="upload-files" type="file" />
          <input
            id="upload-fast-tools-files"
            accept=".pdf,.doc,.docx"
            type="file"
          />
          <input
            id="upload-photos"
            aria-hidden="true"
            accept="image/*"
            type="file"
          />
          <div contenteditable="true" id="prompt-textarea" role="textbox"></div>
          <button data-testid="send-button">Send</button>
        </form>
      </body>
    `);
    const composer = resolveComposer(doc);
    assert.isTrue(composer.ready);
    assert.equal(
      composer.fileInput?.getAttribute("id"),
      "upload-fast-tools-files",
    );
  });

  it("resolves the dedicated upload-files input", function () {
    const doc = fixture(`
      <body>
        <input id="upload-fast-tools-files" type="file" />
        <input id="upload-files" type="file" accept="" />
      </body>
    `);

    assert.equal(
      resolveUploadFilesInput(doc)?.getAttribute("id"),
      "upload-files",
    );
  });

  it("distinguishes a missing file input from ambiguous candidates", function () {
    const doc = fixture(`
      <body>
        <form data-type="unified-composer">
          <div contenteditable="true" id="prompt-textarea" role="textbox"></div>
          <button data-testid="send-button">Send</button>
        </form>
      </body>
    `);
    const composer = resolveComposer(doc);
    assert.isFalse(composer.ready);
    assert.equal(composer.reason, "file-input-not-found");
  });

  it("waits for the canonical send button instead of treating it as composer ambiguity", function () {
    const doc = fixture(`
      <body>
        <form>
          <div contenteditable="true" id="prompt-textarea" role="textbox"></div>
          <input id="upload-files" type="file" />
        </form>
      </body>
    `);
    const composer = resolveComposer(doc);
    assert.isFalse(composer.ready);
    assert.equal(composer.reason, "send-button-not-found");
  });

  it("uses the first canonical prompt when duplicate composer markup is present", function () {
    const doc = fixture(`
      <body>
        <form>
          <textarea id="prompt-textarea" placeholder="One"></textarea>
          <input id="upload-files" type="file" />
          <button data-testid="send-button">Send</button>
        </form>
        <form>
          <textarea id="prompt-textarea" placeholder="Two"></textarea>
          <input id="upload-files-secondary" type="file" />
          <button data-testid="send-button">Send</button>
        </form>
      </body>
    `);
    const composer = resolveComposer(doc);
    assert.isTrue(composer.ready);
    assert.equal(composer.promptInput?.getAttribute("placeholder"), "One");
    assert.equal(composer.composerCount, 1);
  });

  it("does not fall back to generic textareas without the canonical prompt", function () {
    const doc = fixture(`
      <body>
        <form>
          <textarea placeholder="One"></textarea>
          <input type="file" accept="application/pdf" />
        </form>
        <form>
          <textarea placeholder="Two"></textarea>
          <input type="file" accept="application/pdf" />
        </form>
      </body>
    `);
    const composer = resolveComposer(doc);
    assert.isFalse(composer.ready);
    assert.equal(composer.reason, "composer-not-found");
  });

  it("selects the structured composer when an unrelated textarea is mounted", function () {
    const doc = fixture(`
      <body>
        <form>
          <textarea placeholder="Search"></textarea>
        </form>
        <form data-type="unified-composer">
          <div contenteditable="true" id="prompt-textarea" role="textbox"></div>
          <input id="upload-files" type="file" />
          <button data-testid="send-button">Send</button>
        </form>
      </body>
    `);
    const composer = resolveComposer(doc);
    assert.isTrue(composer.ready);
    assert.equal(composer.composerCount, 1);
    assert.equal(composer.fileInput?.getAttribute("id"), "upload-files");
  });

  it("uses the canonical prompt and send controls from the ChatGPT composer", function () {
    const doc = fixture(`
      <body>
        <form>
          <div contenteditable="true" id="prompt-textarea" role="textbox"></div>
          <div contenteditable="true" role="textbox" aria-label="备用输入框"></div>
          <input id="upload-files" type="file" />
          <button data-testid="send-button" hidden>Hidden send</button>
          <button id="composer-submit-button" data-testid="stop-button">Stop</button>
          <button id="composer-submit-button" data-testid="send-button">Send</button>
        </form>
      </body>
    `);
    const composer = resolveComposer(doc);
    assert.isTrue(composer.ready);
    assert.equal(composer.promptInput?.getAttribute("id"), "prompt-textarea");
    assert.equal(
      composer.sendButton?.getAttribute("data-testid"),
      "send-button",
    );
    assert.equal(composer.sendButton?.textContent, "Send");
  });

  it("falls back to a page-level document input when upload input is outside the composer", function () {
    const doc = fixture(`
      <body>
        <form>
          <div contenteditable="true" id="prompt-textarea" role="textbox"></div>
          <button data-testid="send-button">Send</button>
        </form>
        <input id="upload-files" type="file" />
      </body>
    `);
    const composer = resolveComposer(doc);
    assert.isTrue(composer.ready);
    assert.equal(composer.fileInput?.getAttribute("id"), "upload-files");
  });

  it("requires the exact attachment, no busy/error state and enabled send", function () {
    const doc = fixture(`
      <body>
        <form>
          <textarea id="prompt-textarea" placeholder="Message"></textarea>
          <input type="file" />
          <div data-testid="attachment-chip" class="cursor-wait">paper.pdf</div>
          <button data-testid="send-button">Send</button>
        </form>
      </body>
    `);
    const composer = resolveComposer(doc);
    const busy = probeAttachment(
      composer.root!,
      "paper.pdf",
      composer.sendButton,
    );
    assert.isFalse(busy.ready);
    assert.equal(busy.reason, "attachment-busy");
    composer
      .root!.querySelector('[data-testid="attachment-chip"]')!
      .classList.remove("cursor-wait");
    const ready = probeAttachment(
      composer.root!,
      "paper.pdf",
      composer.sendButton,
    );
    assert.isTrue(ready.ready);
  });

  it("exposes attachment and upload-error DOM diagnostics", function () {
    const doc = fixture(`
      <body>
        <div contenteditable="true" id="prompt-textarea"></div>
        <input id="upload-files" type="file" />
        <button data-testid="attachment-chip" aria-label="paper.pdf" class="cursor-wait"></button>
        <div role="alert" data-testid="upload-status">Uploading paper.pdf</div>
        <div role="alert" data-testid="upload-error">Upload failed for paper.pdf</div>
        <button data-testid="send-button">Send</button>
      </body>
    `);
    const composer = resolveComposer(doc);
    const probe = probeAttachment(
      composer.root!,
      "paper.pdf",
      composer.sendButton,
    );
    assert.equal(probe.attachmentDetails?.ariaLabel, "paper.pdf");
    assert.equal(probe.errorDetails.length, 1);
    assert.equal(probe.errorDetails[0]?.testId, "upload-error");
    assert.equal(probe.errorDetails[0]?.text, "Upload failed for paper.pdf");
  });

  it("keeps waiting when any same-name attachment is still uploading", function () {
    const doc = fixture(`
      <body>
        <div contenteditable="true" id="prompt-textarea"></div>
        <input id="upload-files" type="file" />
        <button aria-label="paper.pdf"></button>
        <button aria-label="paper.pdf" class="cursor-wait"></button>
        <button data-testid="send-button">Send</button>
      </body>
    `);
    const composer = resolveComposer(doc);
    const probe = probeAttachment(
      composer.root!,
      "paper.pdf",
      composer.sendButton,
    );
    assert.equal(probe.attachmentCount, 2);
    assert.isTrue(probe.busy);
    assert.equal(probe.reason, "attachment-busy");
  });

  it("does not treat a conversation ID alone as response start evidence", function () {
    const doc = fixture('<body data-conversation-id="new-id"></body>');
    const baseline = captureAssistantBaseline(doc);
    assert.isFalse(probeResponse(doc, baseline).started);
    doc.body.innerHTML =
      '<article data-message-author-role="assistant">Summary</article>';
    const completed = probeResponse(doc, baseline);
    assert.isTrue(completed.started);
    assert.isTrue(completed.completed);
  });

  it("keeps a generated assistant turn incomplete while stop is visible", function () {
    const doc = fixture(`
      <body>
        <article data-message-author-role="assistant">Partial</article>
        <button data-testid="stop-button">Stop</button>
      </body>
    `);
    const response = probeResponse(doc, 0);
    assert.isTrue(response.started);
    assert.isTrue(response.generating);
    assert.isFalse(response.completed);
  });

  it("requires a response to remain stable before completion", function () {
    const probe = {
      assistantCount: 1,
      hasNewAssistant: true,
      started: true,
      generating: false,
      completed: true,
      latestTextLength: 10,
      latestTextFingerprint: "10:partial",
    };
    let state = {
      generationObserved: false,
      signature: "",
      stableSince: null,
    };

    let check = evaluateResponseCompletion(
      { ...probe, generating: true },
      1_000,
      state,
    );
    assert.isFalse(check.completed);
    state = check.state;

    check = evaluateResponseCompletion(probe, 2_000, state);
    assert.isFalse(check.completed);
    state = check.state;

    check = evaluateResponseCompletion(probe, 4_999, state);
    assert.isFalse(check.completed);

    check = evaluateResponseCompletion(probe, 5_000, state);
    assert.isTrue(check.completed);

    check = evaluateResponseCompletion(
      { ...probe, latestTextFingerprint: "11:more-text", latestTextLength: 11 },
      4_100,
      state,
    );
    assert.isFalse(check.completed);

    check = evaluateResponseCompletion(
      { ...probe, hasNewAssistant: false },
      10_000,
      state,
    );
    assert.isFalse(check.completed);
  });
});
