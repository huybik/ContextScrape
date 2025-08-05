// app/api/scrape/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_DURATION_HOURS = 24;
const CACHE_DURATION_MS = CACHE_DURATION_HOURS * 60 * 60 * 1000;

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function cleanupMarkdownWithGemini(rawMarkdown: string): Promise<string> {
  const prompt = `
# GOAL
Turn this into professional API documentation in markdown format in English. Prioritize completeness.

# OUTPUT FORMAT
The output MUST be only the processed, clean Markdown text.
# RAW MARKDOWN INPUT:
${rawMarkdown}
    `;

  try {
    // --- START OF LOGGING CHANGES ---
    console.log("\n--- [GEMINI PROMPT START] ---\n");
    console.log(prompt);
    console.log("\n--- [GEMINI PROMPT END] ---\n");
    // --- END OF LOGGING CHANGES ---

    console.log("[AI] Starting cleanup...");
    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
    });
    const cleanedText = result.text ?? "";

    // --- START OF LOGGING CHANGES ---
    console.log("\n--- [GEMINI RESPONSE START] ---\n");
    console.log(cleanedText);
    console.log("\n--- [GEMINI RESPONSE END] ---\n");
    // --- END OF LOGGING CHANGES ---

    console.log("[AI] Cleanup successful.");
    return cleanedText;
  } catch (error) {
    console.error("[AI ERROR] Failed to clean up markdown:", error);
    console.log("[AI] Falling back to raw markdown content.");
    return rawMarkdown;
  }
}
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
        let accumulatedContentForCache = "";
        const CONCURRENCY_LIMIT = 10;
        const turndownService = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced",
        });

        sendEvent(controller, {
          type: "phase",
          phase: "discovering",
          message: "Phase 1: Discovering all pages...",
        });

        // --- START OF CORRECTED CONCURRENT DISCOVERY ---
        const toVisitQueue: string[] = [startUrl.href];
        const visited = new Set<string>([startUrl.href]);
        let activeRequests = 0;

        const discover = () => {
          return new Promise<void>((resolve, reject) => {
            const processNext = async () => {
              if (req.signal.aborted) {
                // Clear the queue to stop further processing and let active requests finish
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
                  .then((res) => {
                    if (
                      !res.ok ||
                      !res.headers.get("content-type")?.includes("text/html")
                    ) {
                      return null;
                    }
                    return res.text();
                  })
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
                    if (err.name !== "AbortError") {
                      console.error(
                        `Discovery failed for ${currentUrl}:`,
                        err.message
                      );
                    }
                  })
                  .finally(() => {
                    activeRequests--;
                    // Continue processing if there are more items or check if done
                    if (toVisitQueue.length > 0) {
                      processNext();
                    } else if (activeRequests === 0) {
                      resolve();
                    }
                  });
              }

              // If the queue is empty and no requests are active, we are done
              if (toVisitQueue.length === 0 && activeRequests === 0) {
                resolve();
              }
            };

            processNext(); // Start the first batch of requests
          });
        };

        await discover();
        if (req.signal.aborted) throw new Error("AbortError");
        // --- END OF CORRECTED CONCURRENT DISCOVERY ---

        const urlsToProcess = Array.from(visited);
        let processedCount = 0;
        sendEvent(controller, {
          type: "phase",
          phase: "processing",
          message: `Phase 2: Processing ${urlsToProcess.length} pages...`,
          total: urlsToProcess.length,
        });

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
            const $ = cheerio.load(html);
            $("script, style, nav, footer, header, aside, form").remove();
            const contentElement = $("main").length ? $("main") : $("body");
            const contentHtml = contentElement.html();

            if (contentHtml) {
              const markdown = turndownService.turndown(contentHtml);
              const contentChunk = `\n\n---\n\n# Content from: ${urlToProcess}\n\n${markdown}`;
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
        if (req.signal.aborted) throw new Error("AbortError");

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
