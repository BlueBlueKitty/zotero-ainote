menuitem-generateSummary = Generate AI Summary Note
error-noItemsSelected = No items selected
error-noApiKey = API Key not configured. Please set it in preferences.
success-allComplete = All items processed successfully!
progress-extracting = Extracting PDF text...
progress-generating = Generating AI summary...
progress-creating = Creating note...
progress-complete = Complete!

item-section-example1-head-text =
    .label = Plugin Template: Item Info
item-section-example1-sidenav-tooltip =
    .tooltiptext = This is Plugin Template section (item info)
item-section-example2-head-text =
    .label = Plugin Template: Reader [{$status}]
item-section-example2-sidenav-tooltip =
    .tooltiptext = This is Plugin Template section (reader)
item-section-example2-button-tooltip =
    .tooltiptext = Unregister this section
item-info-row-example-label = Example Row

## Note format context menu
note-format-menu = Note Format Adjustment
note-format-fix-math = Fix Math Formulas
note-format-fix-math-desc = Fix common Markdown/LaTeX formulas to Zotero-renderable format
note-format-downgrade-headings = Downgrade All Headings
note-format-downgrade-headings-desc = Downgrade h1-h6 headings by one level, h6 remains unchanged
note-format-upgrade-headings = Upgrade All Headings
note-format-upgrade-headings-desc = Upgrade h1-h6 headings by one level, h1 remains unchanged
note-format-remove-extra-line-breaks = Remove Extra Line Breaks
note-format-remove-extra-line-breaks-desc = Clean empty paragraphs, extra br tags, and broken list lines

## Note format result messages
note-format-result-fix-math = Math formula fix complete: { $inline } inline, { $block } block
note-format-result-fix-math-risky = , { $count } risky skipped
note-format-result-fix-math-unsupported = , { $count } unsupported environment
note-format-no-fixable-formula = No safely fixable formulas detected
note-format-result-downgrade-headings = Headings downgraded: { $count } processed
note-format-result-upgrade-headings = Headings upgraded: { $count } processed
note-format-result-remove-line-breaks = Extra line breaks removed: { $count } blocks, { $merged } merges, { $breaks } breaks
note-format-no-cleanable-breaks = No cleanable extra line breaks detected
note-format-no-headings = No headings detected
note-format-empty-note = Note content is empty, no modification made
note-format-error = Note format adjustment failed, attempted to rollback original content
note-format-please-select-note = Please select a Zotero note first

## Note section (editor context menu) actions
note-section-menu = Section Format Adjustment
note-section-upgrade-heading = Upgrade Current Heading
note-section-downgrade-heading = Downgrade Current Heading
note-section-increase-number = Increase Section Number
note-section-decrease-number = Decrease Section Number
note-section-delete = Delete Current Section
note-section-upgraded = Current section heading upgraded: { $count } headings processed
note-section-downgraded = Current section heading downgraded: { $count } headings processed
note-section-number-increased = Section number increased
note-section-number-decreased = Section number decreased
note-section-deleted = Current section deleted, { $count } nodes removed.
note-section-cant-upgrade = Current section heading cannot be upgraded further
note-section-cant-downgrade = Current section heading cannot be downgraded further
note-section-no-number = No adjustable numbering detected for current heading
note-section-number-min = Current section number is already 1, cannot decrease further
note-section-no-deletable-content = No deletable section content detected
note-section-delete-cancelled = Delete current section cancelled
note-section-request-place-cursor = Please place the cursor in a heading first.
note-section-no-editor-context = No currently editing note found
note-section-error = Section operation failed: { $message }
note-section-rollback-error = Section operation failed, attempted to rollback original content
note-section-number-duplicate-warning = This operation may cause duplicate heading numbers. Please check subsequent headings.
note-section-empty-note = Note content is empty, no modification made
note-section-heading-not-found = Could not locate current heading, please retry.
note-section-delete-confirm = Are you sure you want to delete the current section? This action cannot be undone.

## Error / misc
note-format-unknown-action = Unknown note format action: { $action }
no-selected-note = Please select a Zotero note first
selected-note-not-found = Selected note not found, has it been deleted?
error-noSupportedItems = Please select literature items or their PDF attachments
progress-failed = Failed
progress-continue-next = Continuing with next item...
success-allCompleteDetailed = ✓ All { $total } items processed successfully!
success-partialComplete = Completed: { $success } succeeded, { $failed } failed
