import { describe, it, expect } from "vitest";
import { sanitizeText, sanitizeLessonText, sanitizeStoredText, sanitizeUntrustedPromptText } from "../src/core/utils/sanitize.js";

describe("sanitizeText", () => {
  it("returns null for null and undefined input", () => {
    expect(sanitizeText(null)).toBeNull();
    expect(sanitizeText(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(sanitizeText("")).toBeNull();
    expect(sanitizeText("   ")).toBeNull();
  });

  it("removes newlines and tabs", () => {
    expect(sanitizeText("hello\nworld")).toBe("hello world");
    expect(sanitizeText("hello\tworld")).toBe("hello world");
    expect(sanitizeText("line1\n\n\nline2")).toBe("line1 line2");
  });

  it("normalizes multiple spaces", () => {
    expect(sanitizeText("hello    world")).toBe("hello world");
  });

  it("removes HTML-like characters", () => {
    expect(sanitizeText("<script>alert(1)</script>")).toBe("scriptalert(1)/script");
    expect(sanitizeText("hello `backtick` world")).toBe("hello backtick world");
  });

  it("trims whitespace", () => {
    expect(sanitizeText("  hello  ")).toBe("hello");
  });

  it("truncates to maxLen", () => {
    expect(sanitizeText("abcdefghij", { maxLen: 5 })).toBe("abcde");
  });
});

describe("sanitizeLessonText", () => {
  it("uses default maxLen of 400", () => {
    const long = "a".repeat(500);
    expect(sanitizeLessonText(long)?.length).toBe(400);
  });
});

describe("sanitizeStoredText", () => {
  it("uses default maxLen of 280", () => {
    const long = "a".repeat(300);
    expect(sanitizeStoredText(long)?.length).toBe(280);
  });
});

describe("sanitizeUntrustedPromptText", () => {
  it("uses default maxLen of 1000", () => {
    const long = "a".repeat(1200);
    expect(sanitizeUntrustedPromptText(long)?.length).toBe(1000);
  });
});

describe("sanitizeText with allowedPattern", () => {
  it("keeps only characters matching allowedPattern", () => {
    expect(sanitizeText("hello123!@#", { allowedPattern: /[a-z]/ })).toBe("hello");
  });

  it("combines allowedPattern with other cleaning", () => {
    expect(sanitizeText("  HELLO<world>\n123  ", { allowedPattern: /[a-z]/ })).toBe("world");
  });

  it("keeps uppercase with broader allowedPattern", () => {
    expect(sanitizeText("  HELLO<world>\n123  ", { allowedPattern: /[a-zA-Z]/ })).toBe("HELLOworld");
  });

  it("returns null when allowedPattern removes all characters", () => {
    expect(sanitizeText("123!@#", { allowedPattern: /[a-z]/ })).toBeNull();
  });
});
