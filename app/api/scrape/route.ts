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

// The main POST handler for the scraping request
export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json(); if (!url) {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400,
      });
    }    let startUrl: URL;
    try {
      startUrl = new URL(url);
    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid URL provided" }), {
        status: 400,
      });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const turndownService = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced",
        });
        const queue: string[] = [startUrl.href];
        const visited = new Set<string>();
        const scopeUrl = startUrl.href;

        sendEvent(controller, {
          type: "progress",
          message: `Starting scrape under: ${scopeUrl}`,
        });

        while (queue.length > 0) {
          if (req.signal.aborted) {
            sendEvent(controller, {
              type: "progress",
              message: "Scraping stopped by user.",
            });
            break;
          }

          const currentUrl = queue.shift();
          if (!currentUrl || visited.has(currentUrl)) {
            continue;
          }

          visited.add(currentUrl);

          // *** NEW: Send progress with counts ***
          const totalDiscovered = visited.size + queue.length;
          sendEvent(controller, {
            type: "progress",
            message: `Scraping: ${currentUrl}`,
            scraped: visited.size,
            total: totalDiscovered,
          });

          if (visited.size > 100) {
            sendEvent(controller, {
              type: "progress",
              message: "Reached scrape limit of 100 pages.",
            });
            break;
          }

          let pageMarkdown = "";

          try {
            const response = await fetch(currentUrl, {
              headers: { "User-Agent": "RecursiveScraper/1.0" },
              signal: req.signal,
            });
            if (
              !response.ok ||
              !response.headers.get("content-type")?.includes("text/html")
            ) {
              // Update progress even if we skip the page
              sendEvent(controller, {
                type: "progress",
                message: `Skipping (not HTML): ${currentUrl}`,
                scraped: visited.size,
                total: visited.size + queue.length,
              });
              continue;
            }

            const html = await response.text();
            const $ = cheerio.load(html);
            $("script, style, nav, footer, header, aside, form").remove();
            const contentElement = $("main").length ? $("main") : $("body");
            const contentHtml = contentElement.html();

            if (contentHtml) {
              const markdown = turndownService.turndown(contentHtml);
              pageMarkdown = `\n\n---\n\n# Content from: ${currentUrl}\n\n${markdown}`;
            }

            $("a").each((_, element) => {
              const href = $(element).attr("href");
              if (href) {
                try {
                  const absoluteUrl = new URL(href, startUrl.href);
                  const cleanUrl = absoluteUrl.origin + absoluteUrl.pathname;
                  if (
                    cleanUrl.startsWith(scopeUrl) &&
                    !visited.has(cleanUrl) &&
                    !queue.includes(cleanUrl)
                  ) {
                    queue.push(cleanUrl);
                  }
                } catch (e) {
                  /* Ignore invalid URLs */
                }
              }
            });
          } catch (error: any) {
            if (error.name === "AbortError") {
              console.log("Fetch aborted by client.");
              break;
            }
            sendEvent(controller, {
              type: "progress",
              message: `Failed to scrape ${currentUrl}. Skipping.`,
              scraped: visited.size,
              total: visited.size + queue.length,
            });
          }

          if (pageMarkdown) {
            sendEvent(controller, { type: "content", content: pageMarkdown });
          }
        }

        sendEvent(controller, {
          type: "complete",
          scraped: visited.size,
          total: visited.size,
        });
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
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred." }),
      { status: 500 }
    );
  }
}
