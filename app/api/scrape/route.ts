// app/api/scrape/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- Configuration and helper functions are unchanged ---
const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_DURATION_HOURS = 24;
const CACHE_DURATION_MS = CACHE_DURATION_HOURS * 60 * 60 * 1000;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

async function cleanupMarkdownWithGemini(rawMarkdown: string): Promise<string> {
  // ... (unchanged)
  const prompt = `
# ROLE
You are an expert technical content processor. Your task is to take a raw Markdown file, which has been crudely scraped and concatenated from multiple web pages, and clean it up into single high-quality API documentation markdown file. 
# GOAL
Your primary goal is to transform a collection of scraped web pages single high quality api document in markdown format. The output should be stripped of all other irrelevant information. Also remove all text that is in different language from dominant languages.

# OUTPUT FORMAT
The output MUST be only the processed, clean Markdown text.
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

    // ... (URL normalization and cache setup is unchanged)
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
      // ... (caching logic is unchanged)
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

        // --- START OF CORRECTED CONCURRENT DISCOVERY ---

        // The queue of URLs we need to visit.
        const discoveryQueue = [startUrl.href];
        // A set of all URLs ever found, to prevent duplicates.
        const allFoundUrls = new Set<string>([startUrl.href]);

        // A single worker's task: fetch a URL and return any new links found.
        const discoverLinksOnPage = async (
          currentUrl: string
        ): Promise<string[]> => {
          if (req.signal.aborted) throw new Error("AbortError");

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
            ) {
              return [];
            }

            const html = await response.text();
            const $ = cheerio.load(html);
            const newLinks: string[] = [];

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
                    allFoundUrls.add(cleanUrl); // Add to master set immediately to prevent race conditions
                    newLinks.push(cleanUrl);
                  }
                } catch (e) {
                  /* ignore invalid links */
                }
              }
            });
            return newLinks;
          } catch (e) {
            if (e instanceof Error && e.name === "AbortError") throw e;
            console.error(`Discovery failed for ${currentUrl}:`, e);
            return []; // Return empty array on error
          }
        };

        // Process the queue in batches until it's empty.
        for (let i = 0; i < discoveryQueue.length; i += CONCURRENCY_LIMIT) {
          // Abort if requested by the client
          if (req.signal.aborted) throw new Error("AbortError");

          // Get the next batch of URLs to process concurrently.
          const batch = discoveryQueue.slice(i, i + CONCURRENCY_LIMIT);

          // Run the discovery tasks for the current batch in parallel.
          const results = await Promise.all(
            batch.map((url) => discoverLinksOnPage(url))
          );

          // Flatten the array of arrays of new links and add them to the end of the queue.
          const newUrlsToAdd = results.flat();
          if (newUrlsToAdd.length > 0) {
            discoveryQueue.push(...newUrlsToAdd);
          }
        }

        // --- END OF CORRECTED CONCURRENT DISCOVERY ---

        const urlsToProcess = Array.from(allFoundUrls);
        let processedCount = 0;
        sendEvent(controller, {
          type: "phase",
          phase: "processing",
          message: `Phase 2: Processing ${urlsToProcess.length} pages...`,
          total: urlsToProcess.length,
        });

        // The concurrent processing phase was already correct.
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

        // ... (AI cleaning and final event sending is unchanged)
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
    return new Response(
      JSON.stringify({ error: "An unexpected server error occurred." }),
      { status: 500 }
    );
  }
}
