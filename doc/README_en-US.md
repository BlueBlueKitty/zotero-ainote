# AiNote for Zotero

<p align="center">
    <img src="../imgs/ainote.png" alt="AiNote Logo" width="150" height="150" />
</p>

<p align="center">
    <a href="../README.md">中文版说明请点击这里</a>
</p>

## Introduction

AiNote is a Zotero plugin that automatically generate summary notes for your PDF literature. It supports streaming output and batch processing.

## Features

- **AI-powered PDF summarization**: Generate concise notes for academic papers using your preferred AI model.
- **Real-time streaming display**: View AI-generated content in a popup window with live streaming output.
- **Batch processing**: Select multiple items and generate notes in one click, with clear separation between items.
- **Automatic note creation**: After streaming completes, content is automatically saved to notes.
- **Customizable prompts and models**: Adjust prompts, model, and API endpoint as needed.

## Installation

1. Download the latest release from the [GitHub repository](https://github.com/BlueBlueKitty/zotero-ainote/releases).
2. In Zotero, go to `Tools > Add-ons` and install the AiNote plugin.
3. Restart Zotero if needed.

## Configuration

- Go to `AiNote Preferences` in Zotero.
- Set your **API Key**, **API URL**, and **Model**. These settings are global and will be used for all AI requests.
- Note that when filling in the **API URL**, you may need to add `/chat/completions`, such as: https://api.openai.com/v1/chat/completions

## Usage

- Select one or more PDF items in Zotero.
- Right-click and choose `Generate AI Summary Note`.
- A popup window will appear showing the AI-generated content in real-time.
- For multiple items, each item's content is clearly separated and labeled.
- Once processing completes, all summaries are automatically saved to notes.
- You can close the output window at any time.

<div align="center">
    <span style="display:inline-block; border-radius:12px; overflow:hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.18);">
        <img src="../imgs/example.gif" alt="usage example" style="display:block;" />
    </span>
</div>
