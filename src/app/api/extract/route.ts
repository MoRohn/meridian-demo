import { NextRequest, NextResponse } from "next/server";
import { guardApi } from "@/lib/api/guard";
import { createRequire } from "node:module";
import mammoth from "mammoth";

// The classic v1 API (plain `pdf(buffer)`), not the v2 rewrite — v2 wraps
// pdfjs-dist's worker mode, and its worker-file resolution breaks under
// Turbopack's bundling in Next.js dev/build. v1 runs pdfjs synchronously in
// the same process, which is exactly right for a short-lived API route.
//
// Loaded from the inner lib path, not the package root: pdf-parse's
// index.js has a `module.parent`-gated debug block that tries to read a
// fixture file from its own test folder, which throws ENOENT when that
// check misfires under a bundler. Using `require` (rather than a static
// `import`) also sidesteps TypeScript trying to resolve types for that
// untyped subpath @types/pdf-parse only covers the package root.
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse/lib/pdf-parse.js") as (data: Buffer) => Promise<{ text: string }>;

export const runtime = "nodejs";

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB
// Jev's request budget is ~32k tokens (state + longest question) roughly
// 150k characters of English text. Cap well under that so there's always
// room left for the questions themselves.
const MAX_TEXT_CHARS = 100_000;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

async function extractText(buffer: Buffer, ext: string): Promise<string> {
  if (ext === "txt" || ext === "md") {
    return buffer.toString("utf-8");
  }
  if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (ext === "pdf") {
    const result = await pdf(buffer);
    return result.text;
  }
  throw new Error(`Unsupported file type: .${ext}. Use .pdf, .docx, or .txt.`);
}

export async function POST(req: NextRequest) {
  const blocked = guardApi(req);
  if (blocked) return blocked;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `File is too large (max ${MAX_FILE_BYTES / (1024 * 1024)}MB)` }, { status: 413 });
    }

    const ext = extensionOf(file.name);
    const buffer = Buffer.from(await file.arrayBuffer());

    let text: string;
    try {
      text = await extractText(buffer, ext);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 422 });
    }

    text = text.replace(/\r\n/g, "\n").trim();
    if (!text) {
      return NextResponse.json({ error: "No readable text found in that file." }, { status: 422 });
    }

    let truncated = false;
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS);
      truncated = true;
    }

    return NextResponse.json({ name: file.name, text, truncated });
  } catch (err) {
    console.error("[api/extract] error:", err);
    return NextResponse.json({ error: "Failed to process the file" }, { status: 500 });
  }
}
