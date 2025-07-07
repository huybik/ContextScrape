// app/page.tsx
"use client";

import { useState, FormEvent, useRef, useEffect } from "react";
import { FiDownload, FiLoader, FiSearch, FiXCircle } from "react-icons/fi";
import { FaGithub } from "react-icons/fa";

type Phase =
  | "idle"
  | "discovering"
  | "processing"
  | "cleaning"
  | "complete"
  | "stopped";

function timeSince(date: Date): string {
  // ... (timeSince function is unchanged)
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) {
    const val = Math.floor(interval);
    return `${val} year${val > 1 ? "s" : ""} ago`;
  }
  interval = seconds / 2592000;
  if (interval > 1) {
    const val = Math.floor(interval);
    return `${val} month${val > 1 ? "s" : ""} ago`;
  }
  interval = seconds / 86400;
  if (interval > 1) {
    const val = Math.floor(interval);
    return `${val} day${val > 1 ? "s" : ""} ago`;
  }
  interval = seconds / 3600;
  if (interval > 1) {
    const val = Math.floor(interval);
    return `${val} hour${val > 1 ? "s" : ""} ago`;
  }
  interval = seconds / 60;
  if (interval > 1) {
    const val = Math.floor(interval);
    return `${val} minute${val > 1 ? "s" : ""} ago`;
  }
  return `${Math.floor(seconds)} seconds ago`;
}

export default function HomePage() {
  const [url, setUrl] = useState("https://ai.google.dev/gemini-api/docs/");
  const [isLoading, setIsLoading] = useState(false);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [finalContent, setFinalContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [discoveredCount, setDiscoveredCount] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const historyContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const progressPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem("scrapeHistory");
      if (storedHistory) {
        setHistory(JSON.parse(storedHistory));
      }
    } catch (e) {
      console.error("Failed to parse scrape history from localStorage", e);
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        historyContainerRef.current &&
        !historyContainerRef.current.contains(event.target as Node)
      ) {
        setIsHistoryVisible(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [historyContainerRef]);

  useEffect(() => {
    if (progressPanelRef.current) {
      progressPanelRef.current.scrollTop =
        progressPanelRef.current.scrollHeight;
    }
  }, [progressLog]);

  const updateHistory = (newUrl: string) => {
    const newHistory = [
      newUrl,
      ...history.filter((item) => item !== newUrl),
    ].slice(0, 10);
    setHistory(newHistory);
    localStorage.setItem("scrapeHistory", JSON.stringify(newHistory));
  };

  const startScrape = async (force: boolean = false) => {
    if (!url) {
      setError("Please enter a URL.");
      return;
    }

    updateHistory(url);
    setIsHistoryVisible(false);
    handleReset();
    setIsLoading(true);
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, force }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "An unknown error occurred.");
      }

      const contentType = response.headers.get("content-type");

      if (contentType && contentType.includes("application/json")) {
        const data = await response.json();
        if (data.cacheHit) {
          setPhase("complete");
          setFromCache(true);
          setCacheStatus(
            `Cached version found, updated ${timeSince(
              new Date(data.lastModified)
            )}. Click the button below to download.`
          );
          setFinalContent(data.content);
          setIsLoading(false);
          return;
        }
      }

      if (!response.body) {
        throw new Error("Response body is missing.");
      }

      setPhase("discovering");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const eventSeparator = "\n\n";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            if (buffer.startsWith("data: ")) {
              try {
                const eventData = JSON.parse(buffer.substring(6));
                if (eventData.type === "complete") {
                  setFinalContent(eventData.content.trim());
                  setIsLoading(false);
                  setPhase("complete");
                }
              } catch (e) {
                console.error("Failed to parse final event data:", buffer, e);
                setError(
                  "Failed to parse the final data chunk from the server."
                );
              }
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let separatorIndex;
        while ((separatorIndex = buffer.indexOf(eventSeparator)) !== -1) {
          const line = buffer.substring(0, separatorIndex);
          buffer = buffer.substring(separatorIndex + eventSeparator.length);

          if (line.startsWith("data: ")) {
            try {
              const eventData = JSON.parse(line.substring(6));

              if (eventData.type === "phase") {
                setPhase(eventData.phase);
                setProgressLog((prev) => [
                  ...prev,
                  `[${eventData.phase.toUpperCase()}] ${eventData.message}`,
                ]);
                if (eventData.total) setTotalCount(eventData.total);
              } else if (eventData.type === "discovery") {
                setDiscoveredCount(eventData.discovered);
                setProgressLog((prev) => [...prev, eventData.message]);
              } else if (eventData.type === "processing") {
                setProcessedCount(eventData.processed);
                setProgressLog((prev) => [...prev, eventData.message]);
              } else if (eventData.type === "complete") {
                setFinalContent(eventData.content.trim());
                setIsLoading(false);
                setPhase("complete");
              }
            } catch (e) {
              console.error("Failed to parse event data:", line, e);
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError("Scraping was stopped by the user.");
        setFinalContent(null);
        setPhase("stopped");
      } else {
        setError(`Error processing stream: ${err.message}`);
        setPhase("idle");
      }
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    startScrape(false);
  };

  const handleHistoryClick = (selectedUrl: string) => {
    setUrl(selectedUrl);
    setIsHistoryVisible(false);
  };

  const handleScrapeAgain = () => {
    startScrape(true);
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // --- START OF THE CHANGE ---
  const handleDownload = () => {
    if (!finalContent) return;
    const blob = new Blob([finalContent], {
      // Changed MIME type to be more accurate for a .txt file
      type: "text/plain;charset=utf-8",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    // Changed the file extension from .md to .txt
    a.download = "scraped-content.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  };
  // --- END OF THE CHANGE ---

  const handleReset = () => {
    setIsLoading(false);
    setProgressLog([]);
    setFinalContent(null);
    setError(null);
    setCacheStatus(null);
    setFromCache(false);
    setPhase("idle");
    setProcessedCount(0);
    setTotalCount(0);
    setDiscoveredCount(0);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const percentage = totalCount > 0 ? (processedCount / totalCount) * 100 : 0;

  const getStatusText = () => {
    switch (phase) {
      case "discovering":
        return `Discovering Pages... (${discoveredCount} found)`;
      case "processing":
        return "Processing Content...";
      case "cleaning":
        return "Cleaning up with AI...";
      case "complete":
        return "Scraping Complete!";
      case "stopped":
        return "Scraping Stopped.";
      default:
        return "Idle";
    }
  };

  return (
    <main className="relative container mx-auto flex min-h-screen flex-col items-center justify-center p-8">
      {/*... (rest of the JSX is unchanged) ... */}
      <a
        href="https://github.com/huybik/ContextScrape"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute top-8 right-8 text-slate-400 hover:text-slate-600 transition-colors"
        aria-label="View source on GitHub"
      >
        <FaGithub size={32} />
      </a>

      <div className="w-full max-w-2xl space-y-8">
        <div>
          <h1 className="text-4xl font-bold text-center text-blue-700">
            ContextScrape
          </h1>
          <p className="mt-2 text-center text-slate-500">
            Enter a URL to consolidate its content into a single Markdown file.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2">
            <div className="relative w-full" ref={historyContainerRef}>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onFocus={() => setIsHistoryVisible(true)}
                placeholder="https://example.com/docs/"
                disabled={isLoading}
                className="w-full rounded-md border border-slate-300 px-4 py-3 text-lg focus:border-blue-500 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-black"
                autoComplete="off"
              />
              {isHistoryVisible && history.length > 0 && (
                <div className="absolute top-full mt-2 w-full z-10 rounded-md border border-slate-200 bg-white shadow-lg">
                  <ul className="max-h-60 overflow-y-auto">
                    {history.map((histUrl, index) => (
                      <li
                        key={index}
                        onClick={() => handleHistoryClick(histUrl)}
                        className="cursor-pointer px-4 py-2 text-slate-700 hover:bg-slate-100 truncate"
                        title={histUrl}
                      >
                        {histUrl}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-6 py-3 text-white font-semibold shadow-md hover:bg-blue-700 transition-all disabled:bg-blue-400 disabled:cursor-not-allowed cursor-pointer"
            >
              <FiSearch />
              <span>Scrape</span>
            </button>
          </div>
        </form>

        {cacheStatus && (
          <div className="rounded-md border border-green-300 bg-green-100 p-4 text-center text-green-800">
            <p>{cacheStatus}</p>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-300 bg-red-100 p-4 text-center text-red-700">
            <p>
              <strong>Notice:</strong> {error}
            </p>
          </div>
        )}

        {phase !== "idle" && !fromCache && (
          <div className="w-full rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
                {isLoading && <FiLoader className="animate-spin" />}
                {getStatusText()}
              </h2>
              {isLoading && (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-2 rounded-md bg-red-500 px-4 py-2 text-sm text-white font-semibold shadow-md hover:bg-red-600 transition-all cursor-pointer"
                >
                  <FiXCircle />
                  Stop
                </button>
              )}
            </div>

            {phase === "processing" && (
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm text-slate-600">
                  <span>
                    {processedCount} / {totalCount} pages
                  </span>
                  <span>{Math.round(percentage)}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                    style={{ width: `${percentage}%` }}
                  ></div>
                </div>
              </div>
            )}

            <div
              ref={progressPanelRef}
              className="mt-4 h-64 overflow-y-auto rounded-md bg-slate-50 p-3 text-sm text-slate-500 border"
            >
              {progressLog.map((msg, index) => (
                <p key={index} className="animate-pulse-once">
                  {msg}
                </p>
              ))}
            </div>
          </div>
        )}
        {(phase === "complete" || phase === "stopped") && finalContent && (
          <div className="flex flex-col items-center gap-4">
            <button
              onClick={handleDownload}
              className="flex w-full justify-center items-center gap-2 rounded-md bg-green-600 px-6 py-3 text-white font-semibold shadow-md hover:bg-green-700 transition-all cursor-pointer"
            >
              <FiDownload />
              Download .txt File
            </button>

            {fromCache ? (
              <button
                onClick={handleScrapeAgain}
                className="text-slate-500 hover:text-slate-800 hover:underline cursor-pointer"
              >
                Scrape Again (ignore cache)
              </button>
            ) : (
              <button
                onClick={handleReset}
                className="text-slate-500 hover:text-slate-800 hover:underline cursor-pointer"
              >
                Start Over
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
