import { describe, expect, it } from "vitest";
import { parseChatText, parseInline } from "./chatText";

describe("parseChatText", () => {
  it("splits paragraphs on blank lines and joins soft line breaks", () => {
    expect(parseChatText("First line\ncontinues here.\n\nSecond paragraph.")).toEqual([
      { type: "paragraph", text: "First line continues here." },
      { type: "paragraph", text: "Second paragraph." },
    ]);
  });
  it("reads bullets and numbered steps as lists", () => {
    expect(parseChatText("Options:\n- one\n- **two**\n* three\n\n1. first\n2) second")).toEqual([
      { type: "paragraph", text: "Options:" },
      { type: "bullets", items: ["one", "**two**", "three"] },
      { type: "steps", items: ["first", "second"] },
    ]);
  });
  it("reads a run of > lines as one quoted clause, followed by its reference", () => {
    expect(parseChatText('> "Either party may terminate on\n> thirty days notice."\nSection 6: Termination')).toEqual([
      { type: "quote", text: '"Either party may terminate on thirty days notice."' },
      { type: "paragraph", text: "Section 6: Termination" },
    ]);
  });
  it("keeps a list that follows a paragraph without a blank line", () => {
    expect(parseChatText("Key points\n- a\n- b")).toEqual([{ type: "paragraph", text: "Key points" }, { type: "bullets", items: ["a", "b"] }]);
  });
  it("handles Windows line endings and empty text", () => {
    expect(parseChatText("a\r\n\r\nb")).toHaveLength(2);
    expect(parseChatText("")).toEqual([]);
    expect(parseChatText("  \n \n")).toEqual([]);
  });
  it("never treats text as markup: angle brackets stay plain text", () => {
    expect(parseChatText("<script>alert(1)</script>")).toEqual([{ type: "paragraph", text: "<script>alert(1)</script>" }]);
  });
});

describe("parseInline", () => {
  it("separates bold from plain runs", () => {
    expect(parseInline("a **b** c")).toEqual([{ text: "a ", bold: false }, { text: "b", bold: true }, { text: " c", bold: false }]);
    expect(parseInline("plain")).toEqual([{ text: "plain", bold: false }]);
    expect(parseInline("**** not bold")).toEqual([{ text: "**** not bold", bold: false }]);
  });
});
