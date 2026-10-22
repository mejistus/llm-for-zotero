/**
 * Display helpers for model names in the chat UI.
 */

/**
 * The chat header has room for one short label; the full name is still shown
 * in the button tooltip and in the model menu. Gateway ids often carry several
 * vendor segments (`opencode-go/deepseek-v4.1-flash`), so show the leaf model
 * name instead of the full routing prefix.
 */
export function shortenChatModelLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "";
  const segments = trimmed
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length > 1 ? segments[segments.length - 1] : trimmed;
}
