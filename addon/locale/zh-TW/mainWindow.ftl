menuitem-generateSummary = 生成AI總結筆記
error-noItemsSelected = 未選擇任何條目
error-noApiKey = API密鑰未配置，請在設定中配置。
success-allComplete = 所有條目已成功處理！
progress-extracting = 正在提取PDF文字...
progress-generating = 正在生成AI總結...
progress-creating = 正在建立筆記...
progress-complete = 完成！

item-section-example1-head-text =
    .label = 外掛程式模板: 條目資訊
item-section-example1-sidenav-tooltip =
    .tooltiptext = 這是外掛程式模板面板(條目資訊)
item-section-example2-head-text =
    .label = 外掛程式模板: 閱讀器[{$status}]
item-section-example2-sidenav-tooltip =
    .tooltiptext = 這是外掛程式模板面板(閱讀器)
item-section-example2-button-tooltip =
    .tooltiptext = 移除此面板
item-info-row-example-label = 範例行

## 筆記格式調整上下文選單
note-format-menu = 筆記格式調整
note-format-fix-math = 公式自動修復
note-format-fix-math-desc = 修復常見 Markdown/LaTeX 公式為 Zotero 可渲染格式
note-format-downgrade-headings = 降級所有標題
note-format-downgrade-headings-desc = 將 h1-h6 標題整體降一級，h6 保持不變
note-format-upgrade-headings = 升級所有標題
note-format-upgrade-headings-desc = 將 h1-h6 標題整體升一級，h1 保持不變
note-format-remove-extra-line-breaks = 刪除多餘換行
note-format-remove-extra-line-breaks-desc = 清理空段落、多餘 br 和常見列表斷行

## 筆記格式調整結果訊息
note-format-result-fix-math = 公式自動修復完成：行內 { $inline } 處，區塊級 { $block } 處
note-format-result-fix-math-risky = ，跳過疑似風險片段 { $count } 處
note-format-result-fix-math-unsupported = ，發現未支援環境 { $count } 處
note-format-no-fixable-formula = 未檢測到可安全修復的公式
note-format-result-downgrade-headings = 標題降級完成：共處理 { $count } 個標題
note-format-result-upgrade-headings = 標題升級完成：共處理 { $count } 個標題
note-format-result-remove-line-breaks = 刪除多餘換行完成：刪除空區塊 { $count } 個，合併斷行 { $merged } 處，清理多餘 br { $breaks } 個
note-format-no-cleanable-breaks = 未檢測到可清理的多餘換行
note-format-no-headings = 未檢測到標題
note-format-empty-note = 筆記內容為空，未執行修改
note-format-error = 筆記格式調整失敗，已嘗試回滾原始內容
note-format-please-select-note = 請先選中一條 Zotero 筆記

## 筆記編輯器上下文選單操作（章節操作）
note-section-upgrade-heading = 目前章節標題升級
note-section-downgrade-heading = 目前章節標題降級
note-section-increase-number = 目前章節序號 +1
note-section-decrease-number = 目前章節序號 -1
note-section-delete = 刪除目前章節
note-section-upgraded = 目前章節標題升級完成：共處理 { $count } 個標題
note-section-downgraded = 目前章節標題降級完成：共處理 { $count } 個標題
note-section-number-increased = 目前章節序號已增加
note-section-number-decreased = 目前章節序號已減少
note-section-deleted = 已刪除目前章節，共刪除 { $count } 個節點。
note-section-cant-upgrade = 目前章節標題已無法繼續升級
note-section-cant-downgrade = 目前章節標題已無法繼續降級
note-section-no-number = 目前標題未檢測到可調整的數字序號
note-section-number-min = 目前標題序號已為 1，不能繼續減少。
note-section-no-deletable-content = 未檢測到可刪除的章節內容
note-section-delete-cancelled = 已取消刪除目前章節
note-section-request-place-cursor = 請先將游標放在一個標題中。
note-section-no-editor-context = 未找到目前正在編輯的筆記
note-section-error = 執行章節操作失敗：{ $message }
note-section-rollback-error = 章節操作失敗，已嘗試回滾原始內容
note-section-number-duplicate-warning = 目前操作可能造成標題編號重複，請檢查後續標題編號。
note-section-empty-note = 筆記內容為空，未執行修改
note-section-heading-not-found = 未能定位目前標題，請重試。
note-section-delete-confirm = 確定要刪除目前章節嗎？此操作不可撤銷。

## 錯誤 / 雜項
note-format-unknown-action = 未知的筆記格式化操作: { $action }
no-selected-note = 請先選中一條 Zotero 筆記
selected-note-not-found = 選中的筆記已不存在，可能已被刪除
error-noSupportedItems = 請選擇文獻條目或其下的 PDF 附件
progress-failed = 失敗
progress-continue-next = 繼續處理下一個條目...
success-allCompleteDetailed = ✓ 所有 { $total } 個條目處理完成！
success-partialComplete = 完成：{ $success } 個成功，{ $failed } 個失敗
