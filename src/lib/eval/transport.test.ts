import { describe, expect, it } from "vitest";
import { isPlausibleKey, isSafeKeyTransport } from "./transport";

describe("isSafeKeyTransport", () => {
  it.each([
    ["https://eval.example.com", true],
    ["https://eval.example.com:8443/base", true],
    ["http://localhost:8008", true],
    ["http://127.0.0.1:8008", true],
    ["http://[::1]:8008", true],
    ["http://eval.example.com", false],
    ["http://10.0.0.5:8008", false],
    ["http://localhost.evil.com", false],
    ["http://127.0.0.1.evil.com", false],
    ["ftp://localhost", false],
    ["not a url", false],
    ["", false],
  ])("%s -> %s", (url, safe) => {
    expect(isSafeKeyTransport(url)).toBe(safe);
  });
});

describe("isPlausibleKey", () => {
  it("accepts a provider-shaped key and rejects everything the service would reject", () => {
    expect(isPlausibleKey("sk-proj-abcdefghij0123456789")).toBe(true);
    for (const bad of ["short", "has space in it 1234567890", "line\nbreak-1234567890abcd", "sk-" + "a".repeat(400), "", undefined, null, 123, {}]) {
      expect(isPlausibleKey(bad), String(bad)).toBe(false);
    }
  });
});
