// app/page.tsx
"use client";

import { useState, FormEvent, useRef, useEffect, FC } from "react";

// --- START: SVG Icon Components ---
// These components replace the react-icons library to avoid external dependencies.

const FiDownload: FC<{ className?: string }> = ({ className = "h-5 w-5" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
  </svg>
);

const FiLoader: FC<{ className?: string }> = ({ className = "h-5 w-5" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <line x1="12" y1="2" x2="12" y2="6"></line>
    <line x1="12" y1="18" x2="12" y2="22"></line>
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
    <line x1="2" y1="12" x2="6" y2="12"></line>
    <line x1="18" y1="12" x2="22" y2="12"></line>
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
  </svg>
);

const FiSearch: FC<{ className?: string }> = ({ className = "h-5 w-5" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

const FiXCircle: FC<{ className?: string }> = ({ className = "h-5 w-5" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="15" y1="9" x2="9" y2="15"></line>
    <line x1="9" y1="9" x2="15" y2="15"></line>
  </svg>
);

const FaGithub: FC<{ className?: string; size?: number }> = ({
  className = "",
  size = 32,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 496 512"
    fill="currentColor"
    className={className}
    width={size}
    height={size}
  >
    <path d="M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3.3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.3-6.2-10.1-27.8 2.3-57.4 0 0 21.1-6.9 69.2 25.8 20.1-5.6 41.6-8.4 63.1-8.4 21.5 0 43 2.8 63.1 8.4 48.1-32.6 69.2-25.8 69.2-25.8 12.4 29.6 4.6 51.2 2.3 57.4 16 17.6 23.6 31.4 23.6 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3.7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3.3 2.9 2.3 3.9 1.6 1 3.6.7 4.3-.7.7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3.7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3.7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z" />
  </svg>
);

// --- END: SVG Icon Components ---

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
  const [maxDepth, setMaxDepth] = useState(1);
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
        body: JSON.stringify({ url, force, maxDepth }),
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

  const handleDownload = () => {
    if (!finalContent) return;
    const blob = new Blob([finalContent], {
      type: "text/plain;charset=utf-8",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = "scraped-content.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  };

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
        return "Cleaning up...";
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
          <div className="flex flex-col sm:flex-row items-end gap-2">
            <div className="relative flex-grow w-full" ref={historyContainerRef}>
              <label
                htmlFor="url-input"
                className="block text-sm font-medium text-slate-600 mb-1"
              >
                Start URL
              </label>
              <input
                id="url-input"
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
            <div className="flex-shrink-0">
              <label
                htmlFor="depth-input"
                className="block text-sm font-medium text-slate-600 mb-1"
              >
                Depth
              </label>
              <input
                id="depth-input"
                type="number"
                value={maxDepth}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setMaxDepth(isNaN(val) || val < 0 ? 0 : val);
                }}
                min="0"
                title="Recursive Depth. 0 for this page only, 1 for this page and its links, etc."
                disabled={isLoading}
                className="w-full sm:w-24 h-[50px] text-center rounded-md border border-slate-300 px-2 py-3 text-lg focus:border-blue-500 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-black"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-shrink-0 h-[50px] w-full sm:w-auto flex items-center justify-center gap-2 rounded-md bg-blue-600 px-6 py-3 text-white font-semibold shadow-md hover:bg-blue-700 transition-all disabled:bg-blue-400 disabled:cursor-not-allowed cursor-pointer"
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

