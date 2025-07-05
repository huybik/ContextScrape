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
    const { url } = await req.json();

    if (!url) {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400,
      });
    }

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
        // Initialize Turndown service
        // We can configure it to our liking, e.g., how to handle code blocks.
        const turndownService = new TurndownService({
          headingStyle: "atx", // Use '#' for headings
          codeBlockStyle: "fenced", // Use '```' for code blocks
        });

        const queue: string[] = [startUrl.href];
        const visited = new Set<string>([startUrl.href]);
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
          if (!currentUrl) continue;

          if (visited.size > 100) {
            sendEvent(controller, {
              type: "progress",
              message: "Reached scrape limit of 100 pages.",
            });
            break;
          }

          sendEvent(controller, {
            type: "progress",
            message: `Scraping: ${currentUrl}`,
          });
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
              continue;
            }

            const html = await response.text();
            const $ = cheerio.load(html);

            // --- HTML Cleaning Step ---
            // Remove elements that are not part of the main content
            $("script, style, nav, footer, header, aside, form").remove();

            // --- HTML to Markdown Conversion ---
            // Try to find a <main> element, otherwise fall back to the whole <body>
            const contentElement = $("main").length ? $("main") : $("body");
            const contentHtml = contentElement.html();

            if (contentHtml) {
              const markdown = turndownService.turndown(contentHtml);
              // Add a separator and a heading for each page's content
              pageMarkdown = `\n\n---\n\n# Content from: ${currentUrl}\n\n${markdown}`;
            }

            // Find and enqueue new links
            $("a").each((_, element) => {
              const href = $(element).attr("href");
              if (href) {
                try {
                  const absoluteUrl = new URL(href, startUrl.href);
                  const cleanUrl = absoluteUrl.origin + absoluteUrl.pathname;
                  if (cleanUrl.startsWith(scopeUrl) && !visited.has(cleanUrl)) {
                    visited.add(cleanUrl);
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
            });
          }

          if (pageMarkdown) {
            sendEvent(controller, { type: "content", content: pageMarkdown });
          }
        }

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
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred." }),
      { status: 500 }
    );
  }
}
