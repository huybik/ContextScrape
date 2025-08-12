// app/api/scrape/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
// --- START: Import the new cleaner ---
import { cleanMarkdown } from "../../../utils/markdown-cleaner";
// --- END: Import the new cleaner ---

const CACHE_DIR = path.join("/tmp", ".cache");
const CACHE_DURATION_HOURS = 24;
const CACHE_DURATION_MS = CACHE_DURATION_HOURS * 60 * 60 * 1000;

// --- REMOVED the old localCleanupMarkdown function from this file ---

// ... (keep ensureCacheDirExists, getCacheKey, sendEvent, runConcurrentTasks functions as they are) ...
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
    // ... (keep the entire initial block for POST request handling: url parsing, caching logic, etc.) ...
    // --- THIS PART IS UNCHANGED ---
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
    // --- END UNCHANGED PART ---

    const stream = new ReadableStream({
      async start(controller) {
        // ... (the stream start, discovery phase, and processing setup are all the same) ...
        // --- THIS PART IS UNCHANGED ---
        const allPageMarkdown: string[] = [];
        const CONCURRENCY_LIMIT = 10;
        const turndownService = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced",
        });

        // Discovery phase
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
            const doc = new JSDOM(html, { url: urlToProcess });
            const reader = new Readability(doc.window.document);
            const article = reader.parse();

            if (article && article.content) {
              const markdown = turndownService.turndown(article.content);
              const titleHeader = article.title ? `# ${article.title}\n\n` : "";
              const contentChunk = `\n\n---\n\n## Source: ${urlToProcess}\n\n${titleHeader}${markdown}`;
              allPageMarkdown.push(contentChunk);
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
        // --- END UNCHANGED PART ---

        const accumulatedMarkdown = allPageMarkdown.join("");

        sendEvent(controller, {
          type: "phase",
          phase: "cleaning",
          message: "Phase 3: Applying advanced content cleaning rules...",
        });

        // --- START: Use the new external cleaner ---
        const finalContent = await cleanMarkdown(accumulatedMarkdown);
        // --- END: Use the new external cleaner ---

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
    // ... (keep the final catch block as is) ...
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
