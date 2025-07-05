// app/api/scrape/route.ts
import { NextRequest } from "next/server";
import * as cheerio from "cheerio";
import TurndownService from "turndown";

// Helper function to send events back to the client
function sendEvent(controller: ReadableStreamDefaultController, data: object) {
  try {
    controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    console.log("Client disconnected, could not send event.");
  }
}

// A generic concurrent task runner
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
    const { url } = await req.json();
    let startUrl: URL;
    try {
      startUrl = new URL(url);
    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid URL provided" }), {
        status: 400,
      });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const CONCURRENCY_LIMIT = 5; // Can be higher for discovery
        const scopeUrl = startUrl.href;
        const turndownService = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced",
        });

        // --- PHASE 1: DISCOVERY ---
        sendEvent(controller, {
          type: "phase",
          phase: "discovering",
          message: "Phase 1: Discovering all pages...",
        });
        const urlsToDiscover = [startUrl.href];
        const allFoundUrls = new Set<string>([startUrl.href]);

        for (let i = 0; i < urlsToDiscover.length; i++) {
          if (req.signal.aborted) throw new Error("AbortError");
          const currentUrl = urlsToDiscover[i];
          sendEvent(controller, {
            type: "discovery",
            discovered: allFoundUrls.size,
            message: `Searching: ${currentUrl}`,
          });
          try {
            const response = await fetch(currentUrl, {
              signal: req.signal,
              headers: { "User-Agent": "ContextScribe/1.0" },
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

        // --- PHASE 2: PROCESSING ---
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
            const response = await fetch(urlToProcess, {
              signal: req.signal,
              headers: { "User-Agent": "ContextScribe/1.0" },
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
              sendEvent(controller, {
                type: "content",
                content: `\n\n---\n\n# Content from: ${urlToProcess}\n\n${markdown}`,
              });
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

        sendEvent(controller, { type: "complete" });
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
