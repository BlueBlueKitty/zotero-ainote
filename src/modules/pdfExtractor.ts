import { readIndexedPDFText } from "./zoteroCompat";

/**
 * PDF text extraction utilities
 */

export class PDFExtractor {
  public static async resolvePdfAttachment(
    item: Zotero.Item,
    preferredPdfAttachment?: Zotero.Item,
  ): Promise<Zotero.Item> {
    if (
      preferredPdfAttachment &&
      preferredPdfAttachment.attachmentContentType === "application/pdf"
    ) {
      return preferredPdfAttachment;
    }

    const attachments = item.getAttachments();

    if (attachments.length === 0) {
      throw new Error("No attachments found for this item");
    }

    for (const attachmentID of attachments) {
      const attachment = await Zotero.Items.getAsync(attachmentID);
      if (attachment.attachmentContentType === "application/pdf") {
        return attachment;
      }
    }

    throw new Error("No PDF attachment found for this item");
  }

  /**
   * Extract full text from a Zotero item's PDF attachment
   * @param item Zotero item
   * @returns Extracted text content
   */
  public static async extractTextFromItem(
    item: Zotero.Item,
    preferredPdfAttachment?: Zotero.Item,
  ): Promise<string> {
    const pdfAttachment = await this.resolvePdfAttachment(
      item,
      preferredPdfAttachment,
    );

    // Extract text from PDF
    const text = await this.extractTextFromPDF(pdfAttachment);

    if (!text || text.trim().length === 0) {
      throw new Error("Failed to extract text from PDF or PDF is empty");
    }

    return text;
  }

  public static async extractBase64FromItem(
    item: Zotero.Item,
    preferredPdfAttachment?: Zotero.Item,
  ): Promise<string> {
    const pdfAttachment = await this.resolvePdfAttachment(
      item,
      preferredPdfAttachment,
    );

    const pdfPath = await pdfAttachment.getFilePathAsync();
    if (!pdfPath) {
      throw new Error("Failed to get PDF file path");
    }

    try {
      const pdfData = await Zotero.File.getBinaryContentsAsync(pdfPath);
      if (!pdfData || pdfData.length === 0) {
        throw new Error("PDF file is empty or cannot be read");
      }

      const bytes = new Uint8Array(pdfData.length);
      for (let i = 0; i < pdfData.length; i++) {
        bytes[i] = pdfData.charCodeAt(i);
      }

      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    } catch (error: any) {
      throw new Error(`Failed to read or encode PDF: ${error.message}`);
    }
  }

  /**
   * Extract text from PDF attachment
   * @param pdfAttachment PDF attachment item
   * @returns Extracted text
   */
  private static async extractTextFromPDF(
    pdfAttachment: Zotero.Item,
  ): Promise<string> {
    try {
      return await readIndexedPDFText(pdfAttachment);
    } catch (error: any) {
      throw new Error(`PDF text extraction failed: ${error.message}`);
    }
  }

  /**
   * Clean and format extracted text
   * @param text Raw text
   * @returns Cleaned text
   */
  public static cleanText(text: string): string {
    // Remove excessive whitespace
    text = text.replace(/\s+/g, " ");

    // Remove common PDF artifacts
    // eslint-disable-next-line no-control-regex
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");

    // Normalize line breaks
    text = text.replace(/\r\n/g, "\n");
    text = text.replace(/\r/g, "\n");

    // Remove multiple consecutive newlines
    text = text.replace(/\n{3,}/g, "\n\n");

    return text.trim();
  }

  /**
   * Truncate text to fit API limits (optional)
   * @param text Full text
   * @param maxLength Maximum length
   * @returns Truncated text
   */
  public static truncateText(text: string, maxLength: number = 100000): string {
    if (text.length <= maxLength) {
      return text;
    }

    // Try to truncate at a sentence boundary
    const truncated = text.substring(0, maxLength);
    const lastPeriod = truncated.lastIndexOf(".");

    if (lastPeriod > maxLength * 0.8) {
      return truncated.substring(0, lastPeriod + 1);
    }

    return truncated + "...";
  }
}
