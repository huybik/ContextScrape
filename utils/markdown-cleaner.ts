// utils/markdown-cleaner.ts

import { franc } from "franc";

/**
 * A set of regular expression rules to clean up markdown content.
 * Each rule is an array with the pattern to find and the string or replacer function.
 */
const cleaningRules: [RegExp, string | ((substring: string) => string)][] = [
  // Remove boilerplate navigation links like "Previous", "Next", "Edit this page"
  [/\[(edit this page|view source|previous|next)\]\(.*\)/gi, ""],

  // Remove common boilerplate text patterns, often found in headers/footers
  [
    /^(on this page|in this article|table of contents|was this page helpful\?|still need help\?|contact support|related articles|feedback|legal)\s*$/gim,
    "",
  ],

  // Remove lines that are just dividers or spacers, but keep thematic breaks (---) that are alone on a line.
  [
    /^[\*\-`_]{3,}\s*$/g,
    (match: string) => (match.trim() === "---" ? match : ""),
  ],

  // Remove empty link definitions like `[]()`
  [/\[\]\(\)/g, ""],

  // Remove multiple empty lines, consolidating them into a maximum of two newlines (one blank line).
  [/\n{3,}/g, "\n\n"],

  // Remove leading/trailing whitespace from each line
  [/^[ \t]+|[ \t]+$/gm, ""],
];

/**
 * Cleans and refines raw markdown text extracted from web pages.
 * This function applies a series of rules to remove boilerplate, fix formatting,
 * and filter out non-English content to produce a clean, professional document.
 *
 * @param rawMarkdown The raw markdown string to be cleaned.
 * @returns A promise that resolves to the cleaned markdown string.
 */
export async function cleanMarkdown(rawMarkdown: string): Promise<string> {
  console.log("[CLEANER] Starting markdown cleanup...");

  let cleanedText = rawMarkdown;

  // Apply all regex-based cleaning rules
  for (const [rule, replacement] of cleaningRules) {
    // The 'as any' is a safe cast here due to the known overloads of .replace()
    cleanedText = cleanedText.replace(rule, replacement as any);
  }

  const lines = cleanedText.split("\n");
  const finalLines: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Toggle code block state and always keep the fence lines
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      finalLines.push(line);
      continue;
    }

    // Keep all content within code blocks
    if (inCodeBlock) {
      finalLines.push(line);
      continue;
    }

    // Skip entirely empty lines for language check
    if (line.trim() === "") {
      finalLines.push(line);
      continue;
    }

    // For non-code lines, perform language check.
    const textOnly = line
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1") // Keep text from links
      .replace(/[`\*_~#|]/g, "") // Remove markdown syntax chars
      .trim();

    // Always keep short lines, which are often headers, list items, or technical terms.
    if (textOnly.length < 30) {
      finalLines.push(line);
      continue;
    }

    const lang = franc(textOnly);

    // Keep the line if it's English ('eng') or if the language is undetermined ('und').
    // 'und' often applies to technical jargon, code snippets, or short phrases.
    if (lang === "eng" || lang === "und") {
      finalLines.push(line);
    } else {
      console.log(
        `[CLEANER] Removing non-English line (${lang}): ${line.substring(
          0,
          70
        )}...`
      );
    }
  }

  // Re-join and apply final whitespace consolidation
  let finalMarkdown = finalLines.join("\n");
  finalMarkdown = finalMarkdown.replace(/\n{3,}/g, "\n\n").trim();

  console.log("[CLEANER] Markdown cleanup successful.");
  return finalMarkdown;
}
