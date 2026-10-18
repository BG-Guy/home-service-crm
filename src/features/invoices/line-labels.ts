// Line-row labels shared by the line editor (client) and the document (server).
// Pure, isomorphic.

/**
 * The "Discount" kind label under a discount line, or "" when the line is already
 * named "Discount" (QA2: rows read "Discount | Discount | −$10.00").
 */
export function discountKindLabel(name: string): string {
  return name.trim().toLowerCase() === "discount" ? "" : "Discount";
}
