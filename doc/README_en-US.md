# AiNote for Zotero

<p align="center">
    <img src="../imgs/ainote.png" alt="AiNote Logo" width="150" height="150" />
</p>

<p align="center">
    <a href="../README.md">中文版说明请点击这里</a>
</p>

## Introduction

AiNote is a Zotero plugin for calling large language models to generate and process AI-powered note content within Zotero. It currently supports AI literature summarization, prompt templates, note format adjustment, and quick section operations in the note editor.

## Features

- **AI-powered PDF summarization**: Generate concise notes for academic papers with one click, supporting multiple AI services.
- **Dual PDF processing modes**: Supports `base64 multimodal mode` and `text extraction mode`, allowing you to choose based on model capabilities and speed requirements.
- **Real-time streaming display**: View AI-generated content in a popup window with live streaming output.
- **Batch processing**: Select multiple items and generate notes at once, with each item's content clearly separated.
- **Automatic note saving**: After streaming completes, content is automatically saved to Zotero notes.
- **Prompt templates**: Create and switch between commonly used prompt templates for different summarization tasks.
- **Note format adjustment**: After selecting a note, quickly fix common AI note formatting issues with one click.
- **Quick section editing**: In the note editor, right-click on a heading line to perform heading level changes, section numbering, and deletion.
- **Customizable models and API configuration**: Flexibly adjust model, API endpoint, and prompts.

## Usage

- Select one or more PDF items in Zotero.
- Right-click and choose `Generate AI Summary Note`.
- Select the desired prompt template from the submenu.
- The plugin will execute the AI summary using the selected prompt template and name the generated note based on the template name.
- A popup window will appear showing the AI-generated content in real-time.
- For multiple items, each item's content is clearly labeled and separated.
- Once processing completes, all summaries are automatically saved to corresponding Zotero notes.
- You can close the output window at any time.

### Other Entry Points

- After selecting one or more note items, right-click to use the `Note Format Adjustment` feature.
- When editing a note in the Zotero note editor, if the cursor is on a heading line, the right-click menu will show additional section operation options.

<div align="center">
    <span style="display:inline-block; border-radius:12px; overflow:hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.18);">
        <img src="../imgs/example.gif" alt="usage example" style="display:block;" />
    </span>
</div>

## Installation

1. Download the latest release from the [GitHub repository](https://github.com/BlueBlueKitty/zotero-ainote/releases).
2. In Zotero, go to `Tools > Add-ons` and install the AiNote plugin.
3. Restart Zotero if needed.

## Configuration

### Basic Configuration

Configure the following parameters in Zotero's `Tools > AiNote Preferences`:

- **API Key**: Your AI service API key
- **API URL**: The endpoint URL of the AI service
- **Model**: The model name to use
- **Stream**: Whether to enable streaming output

The plugin automatically detects the service provider based on your configured **API URL** and adapts the calling method accordingly; no manual service type selection is needed.

### Currently Supported AI Services

- Azure OpenAI
- Anthropic Claude
- Google Gemini
- DeepSeek
- OpenAI [Chat Completions API]
- OpenAI [Responses API]

## PDF Processing Modes

The plugin currently supports two PDF processing methods:

### 1. Base64 Multimodal Mode

- Sends PDF content as multimodal input to models that support vision or document understanding.
- Suitable for models with native document understanding capabilities.

### 2. Text Extraction Mode

- First extracts text from the PDF, then sends the text to the model for summarization.
- Suitable for models that do not support multimodal document input or prefer pure text processing.

## Prompt Templates

The plugin supports prompt templates for maintaining different prompt styles for various tasks, such as:

- AI full-text summarization
- AI abstract summarization
- AI structured summarization
- AI innovation point summarization

Using prompt templates makes it easier to reuse existing prompts without manual editing each time.

The plugin also automatically names generated notes based on the currently selected prompt template name, making it easy to distinguish AI notes for different purposes.

## Note-Related Features

### 1. Note Format Adjustment

- Select a note item in Zotero, then use `Note Format Adjustment` from the right-click menu.
- Suitable for cleaning up common AI note formatting issues for easier editing or export.
- Currently includes the following 4 functions:

1. `Fix Math Formulas`
2. `Downgrade All Headings`
3. `Upgrade All Headings`
4. `Remove Extra Line Breaks`

### 2. Quick Section Editing in Note Editor

When editing a note in the Zotero note editor, if the cursor is on a heading line, the right-click menu will show the following 5 functions:

1. `Upgrade Current Heading`
2. `Downgrade Current Heading`
3. `Increase Section Number`
4. `Decrease Section Number`
5. `Delete Current Section`
