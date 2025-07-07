// app/api/scrape/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import fs from "fs";
import path from "path";
import crypto from "crypto";
// --- 1. Import the Google Generative AI SDK ---
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- Caching Configuration ---
const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_DURATION_HOURS = 24;
const CACHE_DURATION_MS = CACHE_DURATION_HOURS * 60 * 60 * 1000;

// --- 2. Initialize the Gemini Model ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-latest" });

// --- 3. Create the prompt and a helper function for AI cleanup ---
async function cleanupMarkdownWithGemini(rawMarkdown: string): Promise<string> {
  const prompt = `
# ROLE
You are an expert technical content processor. Your task is to take a raw Markdown file, which has been crudely scraped and concatenated from multiple web pages, and clean it up for consistency, readability, and proper formatting.

# GOAL
Produce a single, clean, and coherent Markdown document from the provided raw text.

# INSTRUCTIONS
1.  **Standardize Headings:**
    *   Identify the main topic of the entire document and ensure it is represented by a single \`<h1>\` heading at the very top.
    *   Organize content from the different scraped pages into logical sections using \`<h2>\`, \`<h3>\`, etc.
    *   Remove the repetitive \`--- # Content from: http://...\` separator lines. The standardized headings you create will provide the necessary structure.
2.  **De-duplicate Content:**
    *   Remove any obviously repeated boilerplate content that might have been scraped from the header, footer, or navigation bars of every page (e.g., "Sign Up", "Login", "Terms of Service").
3.  **Fix Markdown Syntax:**
    *   Ensure all code snippets are enclosed in proper, language-identified fenced code blocks (e.g., \`\`\`javascript). If the language is unknown, use \`\`\`text.
    *   Correct any broken list formatting, mismatched formatting (like stray asterisks or backticks), and malformed / unnecessary links or images.
4.  **Improve Readability:**
    *   Merge short, fragmented paragraphs where it makes sense to do so.
    *   Ensure there is consistent spacing between elements like headings, paragraphs, and code blocks.

# STRICT CONSTRAINTS
*   **DO NOT** alter or remove any code examples or technical instructions.
*   **DO NOT** add any new information, opinions, or summaries. Your role is to clean and format, not to create content.
*   **DO NOT** change the technical meaning of the text in any way.
*   The output **MUST** be only the cleaned Markdown content. Do not include any preamble, introduction, or post-script like "Here is the cleaned markdown:" or "I hope this helps!".

# RAW MARKDOWN INPUT:
${rawMarkdown}
    `;

  try {
    console.log("[AI] Starting cleanup...");
    const result = await model.generateContent(prompt);
    const response = result.response;
    const cleanedText = response.text();
    console.log("[AI] Cleanup successful.");
    return cleanedText;
  } catch (error) {
    console.error("[AI ERROR] Failed to clean up markdown:", error);
    console.log("[AI] Falling back to raw markdown content.");
    return rawMarkdown; // Fallback to raw content on error
  }
}

// ... (rest of the helper functions: ensureCacheDirExists, getCacheKey, sendEvent, runConcurrentTasks)
function ensureCacheDirExists() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}
function getCacheKey(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex") + ".md";
}
function sendEvent(controller: ReadableStreamDefaultController, data: object) {
  try {
    controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    console.log("Client disconnected, could not send event.");
  }
}
async function runConcurrentTasks<T>(
  items: T[],
  taskFn: (item: T, index: number) => Promise<void>,
  concurrencyLimit: number,
  abortSignal: AbortSignal
) {
  const activeTasks: Promise<void>[] = [];
  let currentIndex = 0;
  for (let i = 0; i < concurrencyLimit && i < items.length; i++) {
    activeTasks.push(runNext());
  }
  await Promise.all(activeTasks);
  function runNext(): Promise<void> {
    if (currentIndex >= items.length || abortSignal.aborted) {
      return Promise.resolve();
    }
    const itemIndex = currentIndex++;
    const item = items[itemIndex];
    const task = taskFn(item, itemIndex).then(() => runNext());
    return task;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { url, force = false } = await req.json();

    let startUrl: URL;
    try {
      startUrl = new URL(url);
    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid URL provided" }), {
        status: 400,
      });
    }

    let normalizedPathname = startUrl.pathname;
    if (normalizedPathname.length > 1 && normalizedPathname.endsWith("/")) {
      normalizedPathname = normalizedPathname.slice(0, -1);
    }
    const canonicalUrlForCache =
      startUrl.origin + normalizedPathname + startUrl.search;
    const scopeUrl = startUrl.origin + normalizedPathname;

    ensureCacheDirExists();
    const cacheKey = getCacheKey(canonicalUrlForCache);
    const cacheFilePath = path.join(CACHE_DIR, cacheKey);

    if (!force && fs.existsSync(cacheFilePath)) {
      const stats = fs.statSync(cacheFilePath);
      const lastModified = stats.mtime;
      const age = Date.now() - lastModified.getTime();

      if (age < CACHE_DURATION_MS) {
        console.log(`[CACHE HIT] Serving fresh content for: ${url}`);
        const content = fs.readFileSync(cacheFilePath, "utf-8");
        return NextResponse.json({
          cacheHit: true,
          lastModified: lastModified.toISOString(),
          content,
        });
      } else {
        console.log(`[CACHE STALE] Re-scraping content for: ${url}`);
      }
    } else if (force) {
      console.log(`[CACHE BYPASS] Forcing re-scrape for: ${url}`);
    } else {
      console.log(`[CACHE MISS] Scraping content for: ${url}`);
    }

    const stream = new ReadableStream({
      async start(controller) {
        let accumulatedContentForCache = "";
        const CONCURRENCY_LIMIT = 5;
        const turndownService = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced",
        });

        sendEvent(controller, {
          type: "phase",
          phase: "discovering",
          message: "Phase 1: Discovering all pages...",
        });
        const urlsToDiscover = [startUrl.href];
        const allFoundUrls = new Set<string>([startUrl.href]);

        for (let i = 0; i < urlsToDiscover.length; i++) {
          if (req.signal.aborted) throw new Error("AbortError");
          // ... (discovery loop logic is unchanged)
          const currentUrl = urlsToDiscover[i];
          sendEvent(controller, {
            type: "discovery",
            discovered: allFoundUrls.size,
            message: `Searching: ${currentUrl}`,
          });
          try {
            const response = await fetch(currentUrl, {
              signal: req.signal,
              headers: { "User-Agent": "ContextScrape/1.0" },
            });
            if (
              !response.ok ||
              !response.headers.get("content-type")?.includes("text/html")
            )
              continue;

            const html = await response.text();
            const $ = cheerio.load(html);
            $("a").each((_, element) => {
              const href = $(element).attr("href");
              if (href) {
                try {
                  const absoluteUrl = new URL(href, startUrl.href);
                  const cleanUrl = absoluteUrl.origin + absoluteUrl.pathname;

                  if (
                    cleanUrl.startsWith(scopeUrl) &&
                    !allFoundUrls.has(cleanUrl)
                  ) {
                    allFoundUrls.add(cleanUrl);
                    urlsToDiscover.push(cleanUrl);
                  }
                } catch (e) {
                  /* ignore invalid links */
                }
              }
            });
          } catch (e) {
            if (e instanceof Error && e.name === "AbortError") throw e;
            console.error(`Discovery failed for ${currentUrl}:`, e);
          }
        }

        const urlsToProcess = Array.from(allFoundUrls);
        let processedCount = 0;
        sendEvent(controller, {
          type: "phase",
          phase: "processing",
          message: `Phase 2: Processing ${urlsToProcess.length} pages...`,
          total: urlsToProcess.length,
        });

        const processTask = async (urlToProcess: string) => {
          try {
            // ... (fetch logic inside processTask is unchanged)
            const response = await fetch(urlToProcess, {
              signal: req.signal,
              headers: { "User-Agent": "ContextScrape/1.0" },
            });
            if (
              !response.ok ||
              !response.headers.get("content-type")?.includes("text/html")
            )
              return;

            const html = await response.text();
            const $ = cheerio.load(html);
            $("script, style, nav, footer, header, aside, form").remove();
            const contentElement = $("main").length ? $("main") : $("body");
            const contentHtml = contentElement.html();

            if (contentHtml) {
              const markdown = turndownService.turndown(contentHtml);
              const contentChunk = `\n\n---\n\n# Content from: ${urlToProcess}\n\n${markdown}`;
              // --- 4. ACCUMULATE ON SERVER, DO NOT SEND CHUNKS ---
              accumulatedContentForCache += contentChunk;
            }
          } catch (e) {
            if (e instanceof Error && e.name === "AbortError") throw e;
            console.error(`Processing failed for ${urlToProcess}:`, e);
          } finally {
            processedCount++;
            sendEvent(controller, {
              type: "processing",
              processed: processedCount,
              total: urlsToProcess.length,
              message: `Processed: ${urlToProcess}`,
            });
          }
        };

        await runConcurrentTasks(
          urlsToProcess,
          processTask,
          CONCURRENCY_LIMIT,
          req.signal
        );

        // --- 5. ADD THE AI CLEANING PHASE ---
        sendEvent(controller, {
          type: "phase",
          phase: "cleaning",
          message: "Phase 3: Cleaning up content with AI...",
        });
        const finalContent = await cleanupMarkdownWithGemini(
          accumulatedContentForCache
        );

        if (finalContent.trim()) {
          try {
            fs.writeFileSync(cacheFilePath, finalContent.trim());
            console.log(`[CACHE WRITE] Saved new content for: ${url}`);
          } catch (writeErr) {
            console.error(
              `[CACHE ERROR] Failed to write cache for ${url}:`,
              writeErr
            );
          }
        }

        // --- 6. SEND ONE COMPLETE EVENT WITH THE FINAL CONTENT ---
        sendEvent(controller, { type: "complete", content: finalContent });
        controller.close();
      },
      cancel(reason) {
        console.log("Stream canceled by client:", reason);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return new Response("Scraping aborted by user.", { status: 200 });
    }
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred." }),
      { status: 500 }
    );
  }
}
