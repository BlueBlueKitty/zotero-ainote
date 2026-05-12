menuitem-generateSummary = 生成AI总结笔记
menuitem-generateSummary-web = 使用网页版大模型总结
menuitem-continueWebChat = 在网页AI中继续对话
error-noItemsSelected = 未选择任何条目
error-noApiKey = API密钥未配置，请在设置中配置。
success-allComplete = 所有条目已成功处理！
progress-extracting = 正在提取PDF文本...
progress-generating = 正在生成AI总结...
progress-creating = 正在创建笔记...
progress-complete = 完成！

item-section-example1-head-text =
    .label = 插件模板: 条目信息
item-section-example1-sidenav-tooltip =
    .tooltiptext = 这是插件模板面板(条目信息)
item-section-example2-head-text =
    .label = 插件模板: 阅读器[{$status}]
item-section-example2-sidenav-tooltip =
    .tooltiptext = 这是插件模板面板(阅读器)
item-section-example2-button-tooltip =
    .tooltiptext = 移除此面板
item-info-row-example-label = 示例行

## 笔记格式调整上下文菜单
note-format-menu = 笔记格式调整
note-format-fix-math = 公式自动修复
note-format-fix-math-desc = 修复常见 Markdown/LaTeX 公式为 Zotero 可渲染格式
note-format-downgrade-headings = 降级所有标题
note-format-downgrade-headings-desc = 将 h1-h6 标题整体降一级，h6 保持不变
note-format-upgrade-headings = 升级所有标题
note-format-upgrade-headings-desc = 将 h1-h6 标题整体升一级，h1 保持不变
note-format-remove-extra-line-breaks = 删除多余换行
note-format-remove-extra-line-breaks-desc = 清理空段落、多余 br 和常见列表断行

## 笔记格式调整结果消息
note-format-result-fix-math = 公式自动修复完成：行内 { $inline } 处，块级 { $block } 处
note-format-result-fix-math-risky = ，跳过疑似风险片段 { $count } 处
note-format-result-fix-math-unsupported = ，发现未支持环境 { $count } 处
note-format-no-fixable-formula = 未检测到可安全修复的公式
note-format-result-downgrade-headings = 标题降级完成：共处理 { $count } 个标题
note-format-result-upgrade-headings = 标题升级完成：共处理 { $count } 个标题
note-format-result-remove-line-breaks = 删除多余换行完成：删除空块 { $count } 个，合并断行 { $merged } 处，清理多余 br { $breaks } 个
note-format-no-cleanable-breaks = 未检测到可清理的多余换行
note-format-no-headings = 未检测到标题
note-format-empty-note = 笔记内容为空，未执行修改
note-format-error = 笔记格式调整失败，已尝试回滚原始内容
note-format-please-select-note = 请先选中一条 Zotero 笔记

## 笔记编辑器上下文菜单操作（章节操作）
note-section-menu = 章节格式调整
note-section-upgrade-heading = 当前章节标题升级
note-section-downgrade-heading = 当前章节标题降级
note-section-increase-number = 当前章节序号 +1
note-section-decrease-number = 当前章节序号 -1
note-section-delete = 删除当前章节
note-section-upgraded = 当前章节标题升级完成：共处理 { $count } 个标题
note-section-downgraded = 当前章节标题降级完成：共处理 { $count } 个标题
note-section-number-increased = 当前章节序号已增加
note-section-number-decreased = 当前章节序号已减少
note-section-deleted = 已删除当前章节，共删除 { $count } 个节点。
note-section-cant-upgrade = 当前章节标题已无法继续升级
note-section-cant-downgrade = 当前章节标题已无法继续降级
note-section-no-number = 当前标题未检测到可调整的数字序号
note-section-number-min = 当前标题序号已为 1，不能继续减少。
note-section-no-deletable-content = 未检测到可删除的章节内容
note-section-delete-cancelled = 已取消删除当前章节
note-section-request-place-cursor = 请先将光标放在一个标题中。
note-section-no-editor-context = 未找到当前正在编辑的笔记
note-section-error = 执行章节操作失败：{ $message }
note-section-rollback-error = 章节操作失败，已尝试回滚原始内容
note-section-number-duplicate-warning = 当前操作可能造成标题编号重复，请检查后续标题编号。
note-section-empty-note = 笔记内容为空，未执行修改
note-section-heading-not-found = 未能定位当前标题，请重试。
note-section-delete-confirm = 确定要删除当前章节吗？此操作不可撤销。

## 错误 / 杂项
note-format-unknown-action = 未知的笔记格式化操作: { $action }
no-selected-note = 请先选中一条 Zotero 笔记
selected-note-not-found = 选中的笔记已不存在，可能已被删除
error-noSupportedItems = 请选择文献条目或其下的 PDF 附件
progress-failed = 失败
progress-continue-next = 继续处理下一个条目...
success-allCompleteDetailed = ✓ 所有 { $total } 个条目处理完成！
success-partialComplete = 完成：{ $success } 个成功，{ $failed } 个失败
web-summary-progress-submitting = 正在提交网页总结任务...
web-summary-success-all-complete = ✓ 所有 { $total } 个网页总结任务处理完成！
web-summary-error-generic = 网页版大模型总结失败
web-summary-open-conversation-start = 正在打开对应网页AI会话...
web-summary-open-conversation-success = 已成功打开对应网页AI会话
web-summary-open-conversation-failed = 打开网页AI会话失败
menuitem-debugFetchWebContent = 重新获取网页总结内容
web-summary-debug-fetch-start = 正在通过 ChatGPT API/DOM 重新获取总结内容...
web-summary-debug-fetch-success = 调试获取成功！已创建含调试信息的笔记
web-summary-debug-fetch-failed = 调试获取网页总结失败
