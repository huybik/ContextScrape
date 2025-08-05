// app/api/scrape/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import fs from "fs";
import path from "path";
import crypto from "crypto";
// --- START: New Imports for Local NLP ---
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { franc } from "franc";
// --- END: New Imports for Local NLP ---

const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_DURATION_HOURS = 24;
const CACHE_DURATION_MS = CACHE_DURATION_HOURS * 60 * 60 * 1000;

// --- START: New Local NLP Cleanup Function (Replaces Gemini) ---
async function localCleanupMarkdown(rawMarkdown: string): Promise<string> {
  console.log("[NLP] Starting local cleanup...");

  const lines = rawMarkdown.split("\n");
  const cleanedLines: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Toggle code block state and always keep the fence lines
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock; // Corrected line
      cleanedLines.push(line);
      continue;
    }

    // Always keep content within code blocks, regardless of language
    if (inCodeBlock) {
      cleanedLines.push(line);
      continue;
    }

    // For non-code lines, perform language check.
    // First, strip markdown to get a clean text representation.
    const textOnly = line
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1") // Keep text from links
      .replace(/[`\*_~#]/g, "") // Remove markdown syntax chars
      .trim();

    // Keep short lines (likely headers, separators) or lines with little text
    if (textOnly.length < 25) {
      cleanedLines.push(line);
      continue;
    }

    const lang = franc(textOnly);

    // Keep the line if it's English ('eng') or if the language is undetermined ('und').
    // 'und' often applies to technical jargon, code snippets, or short phrases.
    if (lang === "eng" || lang === "und") {
      cleanedLines.push(line);
    } else {
      // Optional: log which lines are being removed for debugging
      // console.log(`[NLP] Removing non-English line (${lang}): ${line.substring(0, 70)}...`);
    }
  }

  let finalMarkdown = cleanedLines.join("\n");

  // Consolidate multiple blank lines into a single blank line for cleaner output
  finalMarkdown = finalMarkdown.replace(/\n{3,}/g, "\n\n");

  console.log("[NLP] Local cleanup successful.");
  return finalMarkdown.trim();
}
// --- END: New Local NLP Cleanup Function ---

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
    // This can happen if the client disconnects, it's safe to ignore.
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

  const runNext = (): Promise<void> => {
    if (currentIndex >= items.length || abortSignal.aborted) {
      return Promise.resolve();
    }
    const itemIndex = currentIndex++;
    const item = items[itemIndex];
    const task = taskFn(item, itemIndex).then(() => runNext());
    return task;
  };

  for (let i = 0; i < concurrencyLimit && i < items.length; i++) {
    activeTasks.push(runNext());
  }

  await Promise.all(activeTasks);
}

export async function POST(req: NextRequest) {
  try {
    const { url, force = false } = await req.json();
    let startUrl: URL;
    try {
      startUrl = new URL(url);
    } catch (error) {
      return new NextResponse(
        JSON.stringify({ error: "Invalid URL provided" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
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
        const allPageMarkdown: string[] = [];
        const CONCURRENCY_LIMIT = 10;
        const turndownService = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced",
        });

        // --- Discovery phase remains the same ---
        sendEvent(controller, {
          type: "phase",
          phase: "discovering",
          message: "Phase 1: Discovering all pages...",
        });
        const toVisitQueue: string[] = [startUrl.href];
        const visited = new Set<string>([startUrl.href]);
        let activeRequests = 0;
        const discover = () => {
          return new Promise<void>((resolve) => {
            const processNext = async () => {
              if (req.signal.aborted) {
                while (toVisitQueue.length > 0) toVisitQueue.pop();
                return;
              }
              while (
                toVisitQueue.length > 0 &&
                activeRequests < CONCURRENCY_LIMIT
              ) {
                const currentUrl = toVisitQueue.shift();
                if (!currentUrl) continue;
                activeRequests++;
                sendEvent(controller, {
                  type: "discovery",
                  discovered: visited.size,
                  message: `Searching: ${currentUrl}`,
                });
                fetch(currentUrl, {
                  signal: req.signal,
                  headers: { "User-Agent": "ContextScrape/1.0" },
                })
                  .then((res) =>
                    !res.ok ||
                    !res.headers.get("content-type")?.includes("text/html")
                      ? null
                      : res.text()
                  )
                  .then((html) => {
                    if (html) {
                      const $ = cheerio.load(html);
                      $("a").each((_, element) => {
                        const href = $(element).attr("href");
                        if (!href) return;
                        try {
                          const absoluteUrl = new URL(href, startUrl.href);
                          const cleanUrl =
                            absoluteUrl.origin + absoluteUrl.pathname;
                          if (
                            cleanUrl.startsWith(scopeUrl) &&
                            !visited.has(cleanUrl)
                          ) {
                            visited.add(cleanUrl);
                            toVisitQueue.push(cleanUrl);
                          }
                        } catch (e) {
                          /* ignore invalid URLs */
                        }
                      });
                    }
                  })
                  .catch((err) => {
                    if (err.name !== "AbortError")
                      console.error(
                        `Discovery failed for ${currentUrl}:`,
                        err.message
                      );
                  })
                  .finally(() => {
                    activeRequests--;
                    if (toVisitQueue.length > 0) {
                      processNext();
                    } else if (activeRequests === 0) {
                      resolve();
                    }
                  });
              }
              if (toVisitQueue.length === 0 && activeRequests === 0) {
                resolve();
              }
            };
            processNext();
          });
        };
        await discover();
        if (req.signal.aborted) throw new Error("AbortError");

        const urlsToProcess = Array.from(visited);
        let processedCount = 0;
        sendEvent(controller, {
          type: "phase",
          phase: "processing",
          message: `Phase 2: Processing ${urlsToProcess.length} pages...`,
          total: urlsToProcess.length,
        });

        // --- START: Updated Processing Task using Readability ---
        const processTask = async (urlToProcess: string) => {
          try {
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

            // Use JSDOM and Readability to extract the main, readable content
            const doc = new JSDOM(html, { url: urlToProcess });
            const reader = new Readability(doc.window.document);
            const article = reader.parse();

            if (article && article.content) {
              // If Readability succeeds, we get high-quality structured HTML
              const markdown = turndownService.turndown(article.content);
              const titleHeader = article.title ? `# ${article.title}\n\n` : "";
              const contentChunk = `\n\n---\n\n## Source: ${urlToProcess}\n\n${titleHeader}${markdown}`;
              allPageMarkdown.push(contentChunk);
            }
            // Fallback for pages where Readability might fail is not strictly necessary but can be added here if needed.
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
        // --- END: Updated Processing Task ---

        await runConcurrentTasks(
          urlsToProcess,
          processTask,
          CONCURRENCY_LIMIT,
          req.signal
        );
        if (req.signal.aborted) throw new Error("AbortError");

        const accumulatedMarkdown = allPageMarkdown.join("");

        sendEvent(controller, {
          type: "phase",
          phase: "cleaning",
          message: "Phase 3: Performing local NLP cleanup...",
        });

        // --- Use the new local cleanup function instead of the AI one ---
        const finalContent = await localCleanupMarkdown(accumulatedMarkdown);

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
    console.error("[POST an unexpected error occurred]", error);
    return new NextResponse(
      JSON.stringify({ error: "An unexpected server error occurred." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
