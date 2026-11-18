import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { isSafeIndexedPath } from "@/lib/indexed-path";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_BYTES = 10 * 1024 * 1024;
const MAX_DOCX_EXPANDED_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 1000;
export const SUPPORTED_EXTENSIONS = [
  ".pdf", ".docx", ".txt", ".md", ".mdx", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".json",
  ".csv", ".yaml", ".yml", ".html", ".css", ".scss", ".java", ".go", ".rs", ".sql", ".sh", ".toml", ".xml",
] as const;

export type ParsedDocument = {
  file_path: string;
  raw_content: string;
  file_type: string;
};

function extensionOf(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index < 0 ? "" : fileName.slice(index).toLowerCase();
}

function normalizedName(fileName: string) {
  const name = fileName.trim();
  if (!isSafeIndexedPath(name) || name.includes("/")) throw new Error("Uploaded filename must be a safe relative filename.");
  return name;
}

export function normalizeExtractedText(text: string) {
  return text.replace(/\r\n?/g, "\n");
}

function validateMimeType(extension: string, mimeType?: string) {
  if (!mimeType || mimeType === "application/octet-stream") return;
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  if (extension === ".pdf" && normalized === "application/pdf") return;
  if (extension === ".docx" && normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return;
  if (extension === ".ts" && normalized === "video/mp2t") return;
  if (
    extension !== ".pdf" &&
    extension !== ".docx" &&
    ((extension !== ".ts" && normalized.startsWith("text/")) || [
      "application/json", "application/javascript", "text/javascript", "application/x-javascript",
      "application/typescript", "application/xml", "application/yaml", "application/x-yaml",
      "application/sql", "application/toml", "application/x-sh", "text/x-python", "application/x-python",
      "text/csv", "application/csv",
    ].includes(normalized))
  ) return;
  throw new Error(`${extension.toUpperCase()} files must use a matching supported MIME type.`);
}

function hasSignature(bytes: Uint8Array, signature: number[]) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function validateDocxArchive(bytes: Uint8Array, filePath: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowerBound = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${filePath} is not a valid DOCX archive.`);
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  let offset = view.getUint32(eocd + 16, true);
  if (entries > MAX_DOCX_ENTRIES || directorySize > 2 * 1024 * 1024 || offset + directorySize > bytes.byteLength) {
    throw new Error(`${filePath} contains an unsafe DOCX archive directory.`);
  }
  let expandedBytes = 0;
  const names: string[] = [];
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`${filePath} is not a valid DOCX archive.`);
    }
    const flags = view.getUint16(offset + 8, true);
    const compressedBytes = view.getUint32(offset + 20, true);
    const uncompressedBytes = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.byteLength || (flags & 1) !== 0 || compressedBytes === 0xffffffff || uncompressedBytes === 0xffffffff) {
      throw new Error(`${filePath} contains an unsupported or unsafe DOCX entry.`);
    }
    names.push(new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)));
    expandedBytes += uncompressedBytes;
    if (
      expandedBytes > MAX_DOCX_EXPANDED_BYTES ||
      (uncompressedBytes > 1024 * 1024 && uncompressedBytes / Math.max(1, compressedBytes) > 200)
    ) {
      throw new Error(`${filePath} expands beyond the safe DOCX extraction limit.`);
    }
    offset = end;
  }
  if (!names.includes("[Content_Types].xml") || !names.includes("word/document.xml")) {
    throw new Error(`${filePath} is not a valid Word document.`);
  }
}

export async function parseDocument(fileName: string, bytes: Uint8Array, mimeType?: string): Promise<ParsedDocument> {
  const filePath = normalizedName(fileName);
  const extension = extensionOf(filePath);
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new Error(`Unsupported file format "${extension || "unknown"}". Supported formats: ${SUPPORTED_EXTENSIONS.join(", ")}.`);
  }
  if (!bytes.byteLength) throw new Error(`${filePath} is empty.`);
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error(`${filePath} exceeds the 10 MB per-file upload limit.`);
  validateMimeType(extension, mimeType);

  let text: string;
  if (extension === ".pdf") {
    if (!hasSignature(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) throw new Error(`${filePath} does not have a valid PDF signature.`);
    let parsed;
    try {
      parsed = await pdfParse(Buffer.from(bytes));
    } catch (error) {
      throw new Error(`Could not extract text from ${filePath}. The PDF may be malformed or encrypted.`);
    }
    const pages = parsed.text.split("\f");
    if (pages.length > 1 && pages[pages.length - 1].trim() === "") pages.pop();
    text = pages.map((page, index) => `--- Page ${index + 1} ---\n${page}`).join("\n\n");
    if (!text.replace(/--- Page \d+ ---/g, "").trim()) {
      throw new Error(`${filePath} contains no extractable text. Scanned PDFs require OCR and cannot be indexed.`);
    }
  } else if (extension === ".docx") {
    if (!hasSignature(bytes, [0x50, 0x4b, 0x03, 0x04])) throw new Error(`${filePath} does not have a valid DOCX signature.`);
    try {
      validateDocxArchive(bytes, filePath);
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      text = result.value;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(filePath)) throw error;
      throw new Error(`Could not extract text from ${filePath}. The Word document may be malformed.`);
    }
  } else {
    if (bytes.includes(0)) throw new Error(`${filePath} contains binary data and cannot be read as plain text.`);
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`${filePath} is not valid UTF-8 text.`);
    }
  }

  const rawContent = normalizeExtractedText(text);
  if (!rawContent.trim()) throw new Error(`${filePath} contains no extractable text.`);
  if (Buffer.byteLength(rawContent, "utf8") > MAX_EXTRACTED_BYTES) {
    throw new Error(`${filePath} expands beyond the 10 MB extracted-text limit.`);
  }
  return { file_path: filePath, raw_content: rawContent, file_type: extension.slice(1).toUpperCase() };
}
