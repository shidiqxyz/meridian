/**
 * Shared text sanitization utility.
 * Consolidates duplicate sanitization logic from lessons.js, state.js, index.js.
 */

/**
 * Sanitize text by removing invalid characters, normalizing whitespace, and truncating.
 */
export function sanitizeText(
  text: string | null | undefined,
  { maxLen = 400, allowedPattern = null }: { maxLen?: number; allowedPattern?: RegExp | null } = {}
): string | null {
  if (text == null) return null;
  let cleaned = String(text)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[<>`]/g, "");

  if (allowedPattern) {
    const inner = allowedPattern.source.replace(/^\[/, "").replace(/\]$/, "");
    cleaned = cleaned.replace(new RegExp(`[^${inner}]`, "g"), "");
  }

  cleaned = cleaned.trim().slice(0, maxLen);
  return cleaned || null;
}

// Re-export for backward compatibility
export const sanitizeLessonText = (text: string | null | undefined, maxLen = 400): string | null =>
  sanitizeText(text, { maxLen });

export const sanitizeStoredText = (text: string | null | undefined, maxLen = 280): string | null =>
  sanitizeText(text, { maxLen });

export const sanitizeUntrustedPromptText = (text: string | null | undefined, maxLen = 1000): string | null =>
  sanitizeText(text, { maxLen });
