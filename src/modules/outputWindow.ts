import { config } from "../../package.json";

/**
 * OutputWindow - 用于显示流式 AI 输出的对话框窗口
 * 支持多个条目的分段显示
 */
export class OutputWindow {
  private dialog: any;
  private outputContainer: HTMLElement | null = null;
  private currentItemContainer: HTMLElement | null = null;
  private currentItemBuffer: string = ""; // 累积当前条目的完整内容
  private isOpen: boolean = false;
  private onStopCallback: (() => void) | null = null; // 停止生成的回调
  private stopButton: any = null; // 停止按钮引用
  private mathJaxReady: boolean = false; // MathJax 是否就绪
  private renderMathTimer: ReturnType<typeof setTimeout> | null = null; // 公式渲染节流定时器

  /**
   * 打开输出窗口
   */
  public async open(): Promise<void> {
    if (this.isOpen) {
      return;
    }

    const dialogData: { [key: string]: any } = {
      loadCallback: () => {
        // 应用暗色主题样式
        this.applyTheme();
      },
      unloadCallback: () => {
        this.cleanup();
      },
    };

    this.dialog = new ztoolkit.Dialog(1, 1)
      .addCell(0, 0, {
        tag: "div",
        id: "ainote-output-window",
        styles: {
          width: "800px",
          height: "600px",
          display: "flex",
          flexDirection: "column",
          fontFamily: "system-ui, -apple-system, sans-serif",
        },
        children: [
          // 标题区域
          {
            tag: "div",
            styles: {
              padding: "20px 20px 0 20px",
              flexShrink: "0",
            },
            children: [
              {
                tag: "h2",
                namespace: "html",
                styles: {
                  margin: "0 0 20px 0",
                  fontSize: "20px",
                  borderBottom: "2px solid #59c0bc",
                  paddingBottom: "10px",
                },
                properties: {
                  innerHTML: "AI 总结输出",
                },
              },
            ],
          },
          // 可滚动内容区域
          {
            tag: "div",
            styles: {
              flex: "1",
              overflow: "auto",
              padding: "0 20px",
            },
            children: [
              {
                tag: "div",
                id: "ainote-output-content",
                styles: {
                  fontSize: "14px",
                  lineHeight: "1.6",
                },
              },
            ],
          },
          // 固定在底部的按钮区域
          {
            tag: "div",
            styles: {
              padding: "15px 20px 20px 20px",
              borderTop: "1px solid rgba(89, 192, 188, 0.3)",
              textAlign: "center",
              flexShrink: "0",
            },
            children: [
              {
                tag: "button",
                namespace: "html",
                id: "ainote-stop-button",
                styles: {
                  fontSize: "16px",
                  fontWeight: "700",
                  padding: "12px 32px",
                  backgroundColor: "#ff5722",
                  color: "#ffffff !important",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  minWidth: "140px",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  lineHeight: "normal",
                  verticalAlign: "middle",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  outline: "none",
                  textDecoration: "none",
                  webkitAppearance: "none",
                },
                properties: {
                  innerHTML: "🛑 停止后续条目的AI总结",
                },
              },
            ],
          },
        ],
      })
      .setDialogData(dialogData)
      .open("AI 总结", {
        width: 850,
        height: 680,
        centerscreen: true,
        resizable: true,
      });

    this.isOpen = true;

    // 等待 DOM 完全加载
    await Zotero.Promise.delay(100);

    // 获取输出容器的引用
    if (this.dialog && this.dialog.window) {
      this.outputContainer = this.dialog.window.document.getElementById(
        "ainote-output-content"
      );
      
      // 获取自定义停止按钮
      this.stopButton = this.dialog.window.document.getElementById("ainote-stop-button");
      
      if (this.stopButton) {
        // 注入自定义 CSS 文件
        const cssLink = this.dialog.window.document.createElement("link");
        cssLink.rel = "stylesheet";
        cssLink.href = `chrome://${config.addonRef}/content/outputWindow.css`;
        this.dialog.window.document.head.appendChild(cssLink);
        
        // 等待 CSS 加载完成后根据主题设置颜色
        cssLink.onload = () => {
          this.applyButtonTheme();
        };
        
        // 添加点击事件监听器
        this.stopButton.addEventListener("click", (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          
          try {
            // 立即更新按钮状态为"已停止"
            if (this.stopButton) {
              this.stopButton.disabled = true;
              this.stopButton.innerHTML = "✓ 已停止";
              this.stopButton.style.setProperty("background-color", "#9e9e9e", "important");
              this.stopButton.style.setProperty("cursor", "not-allowed", "important");
              this.stopButton.style.setProperty("opacity", "0.8", "important");
            }
            
            // 调用停止回调
            if (this.onStopCallback) {
              this.onStopCallback();
            }
          } catch (err) {
            ztoolkit.log("[AiNote][OutputWindow] Error in stop handler:", err);
          }
        });
      }
      
      // 应用主题样式
      this.applyTheme();
      
      // 尝试注入 MathJax 用于公式渲染
      this.injectMathJax();
    }
  }

  /**
   * 应用主题样式（支持暗色主题）
   */
  private applyTheme(): void {
    if (!this.dialog || !this.dialog.window) {
      return;
    }

    const doc = this.dialog.window.document;
    const win = this.dialog.window;
    const isDarkMode = win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // 检查 Zotero 是否使用暗色主题
    const zoteroIsDark = doc.documentElement.getAttribute('zotero-theme') === 'dark' ||
                         doc.body.classList.contains('dark') ||
                         isDarkMode;

    const mainContainer = doc.getElementById("ainote-output-window");
    const titleElement = mainContainer?.querySelector("h2");
    const contentElement = doc.getElementById("ainote-output-content");

    if (zoteroIsDark) {
      // 暗色主题
      if (mainContainer) {
        mainContainer.style.backgroundColor = "#2b2b2b";
        mainContainer.style.color = "#e0e0e0";
      }
      if (titleElement) {
        (titleElement as HTMLElement).style.color = "#e0e0e0";
      }
      if (contentElement) {
        contentElement.style.color = "#e0e0e0";
      }
    } else {
      // 亮色主题
      if (mainContainer) {
        mainContainer.style.backgroundColor = "#ffffff";
        mainContainer.style.color = "#333";
      }
      if (titleElement) {
        (titleElement as HTMLElement).style.color = "#333";
      }
      if (contentElement) {
        contentElement.style.color = "#333";
      }
    }
    
    // 同时应用按钮主题
    this.applyButtonTheme();
  }

  /**
   * 根据主题设置按钮颜色
   */
  private applyButtonTheme(): void {
    if (!this.stopButton || !this.dialog || !this.dialog.window) {
      return;
    }

    const doc = this.dialog.window.document;
    const win = this.dialog.window;
    const isDarkMode = win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // 检查 Zotero 是否使用暗色主题
    const zoteroIsDark = doc.documentElement.getAttribute('zotero-theme') === 'dark' ||
                         doc.body.classList.contains('dark') ||
                         isDarkMode;

    if (zoteroIsDark) {
      // 暗色主题：白色文字在橙红色背景上
      this.stopButton.style.setProperty("color", "#ffffff", "important");
      this.stopButton.style.setProperty("background-color", "#ff5722", "important");
    } else {
      // 亮色主题：深色文字在橙红色背景上
      this.stopButton.style.setProperty("color", "#1a1a1a", "important");
      this.stopButton.style.setProperty("background-color", "#ff5722", "important");
    }
  }

  /**
   * 检查是否是暗色主题
   */
  private isDarkTheme(): boolean {
    if (!this.dialog || !this.dialog.window) {
      return false;
    }
    const doc = this.dialog.window.document;
    const win = this.dialog.window;
    const isDarkMode = win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches;
    return doc.documentElement.getAttribute('zotero-theme') === 'dark' ||
           doc.body.classList.contains('dark') ||
           isDarkMode;
  }

  /**
   * 开始新的条目
   * @param itemTitle 条目标题
   */
  public startItem(itemTitle: string): void {
    if (!this.outputContainer) {
      return;
    }

    // 重置 buffer
    this.currentItemBuffer = "";

    // 检查是否是暗色主题
    const isDark = this.isDarkTheme();
    
    // 创建新的条目容器
    const itemDiv = ztoolkit.UI.appendElement(
      {
        tag: "div",
        styles: {
          marginBottom: "30px",
          padding: "15px",
          backgroundColor: isDark ? "#3a3a3a" : "#f9f9f9",
          borderRadius: "8px",
          border: isDark ? "1px solid #555" : "1px solid #e0e0e0",
        },
        children: [
          {
            tag: "h3",
            namespace: "html",
            styles: {
              margin: "0 0 15px 0",
              color: "#59c0bc",
              fontSize: "16px",
              fontWeight: "bold",
              wordBreak: "break-word",
            },
            properties: {
              innerHTML: `📄 AI 总结 - ${this.escapeHtml(itemTitle)}`,
            },
          },
          {
            tag: "div",
            id: `item-content-${Date.now()}`,
            styles: {
              wordWrap: "break-word",
              color: isDark ? "#d0d0d0" : "#555",
              fontSize: "14px",
              lineHeight: "1.8",
            },
            properties: {
              innerHTML: "",
            },
          },
        ],
      },
      this.outputContainer
    );

    // 找到内容容器
    this.currentItemContainer = (itemDiv as HTMLElement).querySelector(
      "div[id^='item-content-']"
    ) as HTMLElement;

    // 滚动到底部
    this.scrollToBottom();
  }

  /**
   * 追加流式内容到当前条目
   * @param chunk 文本片段
   */
  public appendContent(chunk: string): void {
    if (!this.currentItemContainer) {
      return;
    }

    // 累积到 buffer
    this.currentItemBuffer += chunk;

    // 将 Markdown 转换为 HTML 并显示
    const html = this.convertMarkdownToHTML(this.currentItemBuffer);
    this.currentItemContainer.innerHTML = html;

    // 不在流式输出时渲染公式，等完成后再渲染
    
    // 滚动到底部
    this.scrollToBottom();
  }

  /**
   * 完成当前条目
   */
  public finishItem(): void {
    if (this.currentItemContainer) {
      // 完成后渲染公式
      this.renderMath();
      
      // 添加一个完成标记
      const parent = this.currentItemContainer.parentElement;
      if (parent) {
        ztoolkit.UI.appendElement(
          {
            tag: "div",
            styles: {
              marginTop: "10px",
              color: "#59c0bc",
              fontSize: "12px",
              fontStyle: "italic",
            },
            properties: {
              innerHTML: "✓ 已完成并保存到笔记",
            },
          },
          parent
        );
      }
    }
    this.currentItemContainer = null;
    this.scrollToBottom();
  }

  /**
   * 显示完成消息
   * @param successCount 成功数量
   * @param totalCount 总数量
   */
  public showComplete(successCount: number, totalCount: number): void {
    if (!this.outputContainer) {
      return;
    }

    const isDark = this.isDarkTheme();
    const failedCount = totalCount - successCount;
    const allSuccess = failedCount === 0;
    const allFailed = successCount === 0;

    // 根据结果确定样式和消息
    let backgroundColor: string;
    let borderColor: string;
    let icon: string;
    let title: string;
    let message: string;

    if (allSuccess) {
      backgroundColor = isDark ? "#2d4a2d" : "#e8f5e9";
      borderColor = "#59c0bc";
      icon = "🎉";
      title = "处理完成！";
      message = `成功处理 ${successCount} 个条目，内容已保存到笔记中。`;
    } else if (allFailed) {
      backgroundColor = isDark ? "#4a2d2d" : "#ffebee";
      borderColor = "#f44336";
      icon = "❌";
      title = "处理失败";
      message = `所有 ${totalCount} 个条目均处理失败，请检查错误信息。`;
    } else {
      backgroundColor = isDark ? "#4a3d2d" : "#fff3e0";
      borderColor = "#ff9800";
      icon = "⚠️";
      title = "部分完成";
      message = `成功处理 ${successCount} 个条目，${failedCount} 个条目失败。`;
    }

    ztoolkit.UI.appendElement(
      {
        tag: "div",
        styles: {
          marginTop: "30px",
          padding: "20px",
          backgroundColor,
          borderRadius: "8px",
          border: `2px solid ${borderColor}`,
          textAlign: "center",
        },
        children: [
          {
            tag: "div",
            styles: {
              fontSize: "18px",
              fontWeight: "bold",
              color: isDark ? "#e0e0e0" : "#333",
              marginBottom: "10px",
            },
            properties: {
              innerHTML: `${icon} ${title}`,
            },
          },
          {
            tag: "div",
            styles: {
              fontSize: "14px",
              color: isDark ? "#d0d0d0" : "#555",
            },
            properties: {
              innerHTML: message,
            },
          },
        ],
      },
      this.outputContainer
    );

    this.scrollToBottom();
  }

  /**
   * 显示停止消息
   * @param successCount 成功数量
   * @param failedCount 失败数量
   * @param notProcessed 未处理数量
   */
  public showStopped(successCount: number, failedCount: number, notProcessed: number): void {
    if (!this.outputContainer) {
      return;
    }

    const isDark = this.isDarkTheme();
    const total = successCount + failedCount + notProcessed;

    ztoolkit.UI.appendElement(
      {
        tag: "div",
        styles: {
          marginTop: "30px",
          padding: "20px",
          backgroundColor: isDark ? "#3d3d2d" : "#fff9e6",
          borderRadius: "8px",
          border: "2px solid #ff9800",
          textAlign: "center",
        },
        children: [
          {
            tag: "div",
            styles: {
              fontSize: "18px",
              fontWeight: "bold",
              color: isDark ? "#ffb74d" : "#f57c00",
              marginBottom: "10px",
            },
            properties: {
              innerHTML: "⏸️ AI 生成已停止",
            },
          },
          {
            tag: "div",
            styles: {
              fontSize: "14px",
              color: isDark ? "#d0d0d0" : "#555",
              marginBottom: "5px",
            },
            properties: {
              innerHTML: `总共 ${total} 个条目：`,
            },
          },
          {
            tag: "div",
            styles: {
              fontSize: "14px",
              color: isDark ? "#81c784" : "#388e3c",
              marginBottom: "3px",
            },
            properties: {
              innerHTML: `✓ 已成功生成：${successCount} 个`,
            },
          },
          {
            tag: "div",
            styles: {
              fontSize: "14px",
              color: isDark ? "#e57373" : "#d32f2f",
              marginBottom: "3px",
            },
            properties: {
              innerHTML: `✗ 生成失败：${failedCount} 个`,
            },
          },
          {
            tag: "div",
            styles: {
              fontSize: "14px",
              color: isDark ? "#90a4ae" : "#607d8b",
            },
            properties: {
              innerHTML: `⊘ 未处理：${notProcessed} 个`,
            },
          },
        ],
      },
      this.outputContainer
    );

    this.scrollToBottom();
  }

  /**
   * 显示错误消息
   * @param itemTitle 条目标题
   * @param error 错误信息
   */
  public showError(itemTitle: string, error: string): void {
    if (!this.outputContainer) {
      return;
    }

    const isDark = this.isDarkTheme();

    ztoolkit.UI.appendElement(
      {
        tag: "div",
        styles: {
          marginBottom: "20px",
          padding: "15px",
          backgroundColor: isDark ? "#4a2d2d" : "#ffebee",
          borderRadius: "8px",
          border: isDark ? "1px solid #e57373" : "1px solid #ef5350",
        },
        children: [
          {
            tag: "h3",
            styles: {
              margin: "0 0 10px 0",
              color: isDark ? "#e57373" : "#c62828",
              fontSize: "16px",
              fontWeight: "bold",
            },
            properties: {
              innerHTML: `❌ ${this.escapeHtml(itemTitle)}`,
            },
          },
          {
            tag: "div",
            styles: {
              color: isDark ? "#d0d0d0" : "#666",
              fontSize: "14px",
            },
            properties: {
              innerHTML: `错误: ${this.escapeHtml(error)}`,
            },
          },
        ],
      },
      this.outputContainer
    );

    this.scrollToBottom();
  }

  /**
   * 关闭窗口
   */
  public close(): void {
    if (this.dialog && this.dialog.window) {
      this.dialog.window.close();
    }
  }

  /**
   * 清理窗口状态
   */
  private cleanup(): void {
    this.isOpen = false;
    this.dialog = undefined;
    this.outputContainer = null;
    this.currentItemContainer = null;
    this.onStopCallback = null;
    this.stopButton = null;
  }

  /**
   * 设置停止回调
   * @param callback 停止时的回调函数
   */
  public setOnStop(callback: () => void): void {
    this.onStopCallback = callback;
  }

  /**
   * 禁用停止按钮
   * @param stopped 是否是因为用户停止（true）还是正常完成（false）
   */
  public disableStopButton(stopped: boolean = false): void {
    if (this.stopButton && !this.stopButton.disabled) {
      // 只有按钮未被禁用时才更新（避免重复更新）
      this.stopButton.disabled = true;
      this.stopButton.innerHTML = stopped ? "✓ 已停止" : "✓ 已完成";
      this.stopButton.style.setProperty("background-color", "#9e9e9e", "important");
      this.stopButton.style.setProperty("cursor", "not-allowed", "important");
      this.stopButton.style.setProperty("opacity", "0.8", "important");
    }
  }

  /**
   * 检查窗口是否打开
   */
  public get opened(): boolean {
    return this.isOpen && !!this.dialog && !!this.dialog.window;
  }

  /**
   * 滚动到底部
   */
  private scrollToBottom(): void {
    if (!this.dialog || !this.dialog.window) {
      return;
    }

    // 使用 setTimeout 确保在 DOM 更新后滚动
    setTimeout(() => {
      if (!this.outputContainer) return;
      
      // 滚动到容器底部（现在需要滚动父容器）
      const scrollContainer = this.outputContainer.parentElement;
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }, 10); // 增加延迟确保渲染完成
  }

  /**
   * 注入 MathJax 用于公式渲染
   */
  private injectMathJax(): void {
    if (!this.dialog?.window?.document) return;

    try {
      const doc = this.dialog.window.document;
      const win = this.dialog.window as any;

      // 配置 MathJax
      const configScript = doc.createElement("script");
      configScript.type = "text/javascript";
      configScript.text = `
        window.MathJax = {
          tex: {
            inlineMath: [['$', '$']],
            displayMath: [['$$', '$$']],
          },
          svg: {
            fontCache: 'global'
          },
          options: {
            // 禁用辅助功能 MML，避免跨文档错误
            enableAssistiveMml: false,
            renderActions: {
              assistiveMml: []
            }
          },
          startup: {
            ready: () => {
              MathJax.startup.defaultReady();
            }
          }
        };
      `;
      doc.head.appendChild(configScript);

      // 加载本地 MathJax 库，尝试两种可能的路径（打包时有时位于 es5/ 目录）
      const mathjaxScript = doc.createElement("script");
      const localCandidates = [
        `chrome://${config.addonRef}/content/lib/mathjax/tex-svg.js`,
        `chrome://${config.addonRef}/content/lib/mathjax/es5/tex-svg.js`,
      ];

      // 尝试第一个候选路径
      mathjaxScript.src = localCandidates[0];
      mathjaxScript.async = true;
      mathjaxScript.onload = () => {
        try {
          const winAny = this.dialog!.window as any;
          if (winAny.MathJax && winAny.MathJax.typesetPromise) {
            this.mathJaxReady = true;
          }
        } catch (e) {
          // ignore
        }
      };
      mathjaxScript.onerror = () => {
        // 如果还有备用路径,尝试下一个
        const next = localCandidates.find((p) => p !== mathjaxScript.src);
        if (next) {
          mathjaxScript.src = next;
          doc.head.appendChild(mathjaxScript);
        }
      };
      doc.head.appendChild(mathjaxScript);
    } catch (err) {
      ztoolkit.log("[AiNote][OutputWindow] Error injecting MathJax:", err);
    }
  }

  /**
   * 渲染公式（调用 MathJax）
   */
  private async renderMath(): Promise<void> {
    if (!this.dialog?.window || !this.outputContainer) return;

    try {
      const win = this.dialog.window as any;
      // 等待 MathJax 可用（最多重试 10 次，每次 200ms）
      let attempts = 0;
      while (attempts < 10) {
        if (win.MathJax && win.MathJax.typesetPromise) {
          try {
            // 只渲染输出容器内的公式，避免跨文档错误
            await win.MathJax.typesetPromise([this.outputContainer]);
            this.mathJaxReady = true;
            return;
          } catch (e) {
            return;
          }
        }
        attempts++;
        const maybeZotero = (globalThis as any).Zotero;
        if (maybeZotero && maybeZotero.Promise && typeof maybeZotero.Promise.delay === 'function') {
          await maybeZotero.Promise.delay(200);
        } else {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    } catch (err) {
      // ignore
    }
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    const div = this.dialog?.window?.document?.createElement("div") || null;
    if (!div) {
      return text.replace(/[&<>"']/g, (char) => {
        const escapeMap: { [key: string]: string } = {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        };
        return escapeMap[char] || char;
      });
    }
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 将 Markdown 转换为 HTML（简化版）
   */
  private convertMarkdownToHTML(markdown: string): string {
    let html = markdown;

    // 先保护公式，避免被其他 Markdown 语法破坏
    const formulas: string[] = [];
    
    // 转换 LaTeX 公式格式并保护：\[...\] → $$...$$
    html = html.replace(/\\\[([\s\S]*?)\\\]/g, (match, formula) => {
      const placeholder = `___FORMULA_BLOCK_${formulas.length}___`;
      formulas.push(`$$${formula}$$`);
      return placeholder;
    });
    
    // 保护已有的 $$ $$ 块级公式
    html = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
      const placeholder = `___FORMULA_BLOCK_${formulas.length}___`;
      formulas.push(match); // 保持原样
      return placeholder;
    });
    
    // 转换并保护行内公式：\(...\) → $...$
    html = html.replace(/\\\((.*?)\\\)/g, (match, formula) => {
      const placeholder = `___FORMULA_INLINE_${formulas.length}___`;
      formulas.push(`$${formula}$`);
      return placeholder;
    });
    
    // 保护已有的 $ $ 行内公式
    // eslint-disable-next-line no-useless-escape
    html = html.replace(/\$([^\$\n]+?)\$/g, (match) => {
      const placeholder = `___FORMULA_INLINE_${formulas.length}___`;
      formulas.push(match); // 保持原样
      return placeholder;
    });

    // 处理水平分隔线（在处理列表之前）
    html = html.replace(/^---+$/gm, "<hr style='border: none; border-top: 1px solid rgba(89, 192, 188, 0.3); margin: 20px 0;'>");
    html = html.replace(/^\*\*\*+$/gm, "<hr style='border: none; border-top: 1px solid rgba(89, 192, 188, 0.3); margin: 20px 0;'>");
    html = html.replace(/^___+$/gm, "<hr style='border: none; border-top: 1px solid rgba(89, 192, 188, 0.3); margin: 20px 0;'>");

    // 处理标题
    html = html.replace(/^#### (.*$)/gim, "<h4>$1</h4>");
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

    // 处理粗体（现在不会破坏公式了）
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    
    // 处理斜体
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    // 处理代码块
    html = html.replace(/```[\s\S]*?```/g, (match) => {
      const code = match.replace(/```\w*\n?/, "").replace(/```$/, "");
      return `<pre style="background: rgba(0,0,0,0.1); padding: 10px; border-radius: 4px; overflow-x: auto;"><code>${this.escapeHtmlSimple(code)}</code></pre>`;
    });

    // 处理行内代码
    html = html.replace(/`(.+?)`/g, '<code style="background: rgba(0,0,0,0.1); padding: 2px 4px; border-radius: 2px;">$1</code>');

    // 处理段落和列表
    const paragraphs = html.split(/\n\n+/);
    const processed = paragraphs.map((para) => {
      para = para.trim();
      if (!para) return "";
      
      if (para.startsWith("<h") || para.startsWith("<pre>")) {
        return para;
      }

      const lines = para.split("\n");
      let inList = false;
      let listType = "";
      let result = "";

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        // 跳过已经转换的 HTML 标签（如分隔线）
        if (line.startsWith("<")) {
          if (inList) {
            result += `</${listType}>`;
            inList = false;
          }
          result += line;
          continue;
        }

        // 无序列表（确保不是分隔线）
        if (line.match(/^[-*+]\s+/) && !line.match(/^[-*_]{3,}$/)) {
          if (!inList || listType !== "ul") {
            if (inList) result += `</${listType}>`;
            result += "<ul style='margin: 10px 0; padding-left: 30px;'>";
            inList = true;
            listType = "ul";
          }
          result += `<li style='margin: 5px 0;'>${line.replace(/^[-*+]\s+/, "")}</li>`;
        }
        // 有序列表
        else if (line.match(/^\d+\.\s+/)) {
          if (!inList || listType !== "ol") {
            if (inList) result += `</${listType}>`;
            result += "<ol style='margin: 10px 0; padding-left: 30px;'>";
            inList = true;
            listType = "ol";
          }
          result += `<li style='margin: 5px 0;'>${line.replace(/^\d+\.\s+/, "")}</li>`;
        }
        // 普通文本
        else {
          if (inList) {
            result += `</${listType}>`;
            inList = false;
          }
          if (line.startsWith("<")) {
            result += line;
          } else {
            result += `<p style='margin: 8px 0;'>${line}</p>`;
          }
        }
      }

      if (inList) {
        result += `</${listType}>`;
      }

      return result;
    });

    html = processed.join("");
    
    // 恢复所有公式（按索引替换）
    html = html.replace(/___FORMULA_(BLOCK|INLINE)_(\d+)___/g, (match, type, index) => {
      return formulas[parseInt(index)] || match;
    });

    return html;
  }

  /**
   * 简单的 HTML 转义（用于代码块）
   */
  private escapeHtmlSimple(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
