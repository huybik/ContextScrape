// app/page.tsx
"use client";

import { useState, FormEvent, useRef, useEffect } from "react";
import { FiDownload, FiLoader, FiSearch, FiXCircle } from "react-icons/fi";

type Phase = "idle" | "discovering" | "processing" | "complete" | "stopped";

export default function HomePage() {
  const [url, setUrl] = useState("https://ai.google.dev/gemini-api/docs/");
  const [isLoading, setIsLoading] = useState(false);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [finalContent, setFinalContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [discoveredCount, setDiscoveredCount] = useState(0);

  const abortControllerRef = useRef<AbortController | null>(null);
  const progressPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (progressPanelRef.current) {
      progressPanelRef.current.scrollTop =
        progressPanelRef.current.scrollHeight;
    }
  }, [progressLog]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url) {
      setError("Please enter a URL.");
      return;
    }

    handleReset();
    setIsLoading(true);
    setPhase("discovering");

    abortControllerRef.current = new AbortController();
    let accumulatedContent = "";

    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok || !response.body) {
        const errorData = await response.json();
        throw new Error(errorData.error || "An unknown error occurred.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
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
            } else if (eventData.type === "content") {
              accumulatedContent += eventData.content;
            } else if (eventData.type === "complete") {
              setFinalContent(accumulatedContent.trim());
              setIsLoading(false);
              setPhase("complete");
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError("Scraping was stopped by the user.");
        setFinalContent(accumulatedContent.trim());
        setPhase("stopped");
      } else {
        setError(err.message);
        setPhase("idle");
      }
      setIsLoading(false);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleDownload = () => {
    if (!finalContent) return;
    const blob = new Blob([finalContent], {
      type: "text/markdown;charset=utf-8",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = "scraped-content.md";
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
      case "complete":
        return "Scraping Complete!";
      case "stopped":
        return "Scraping Stopped.";
      default:
        return "Idle";
    }
  };

  return (
    <main className="container mx-auto flex min-h-screen flex-col items-center justify-center p-8">
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
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/docs/"
              disabled={isLoading}
              className="w-full rounded-md border border-slate-300 px-4 py-3 text-lg focus:border-blue-500 focus:ring-blue-500 disabled:bg-slate-100"
            />
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

        {error && (
          <div className="rounded-md border border-red-300 bg-red-100 p-4 text-center text-red-700">
            <p>
              <strong>Notice:</strong> {error}
            </p>
          </div>
        )}

        {phase !== "idle" && (
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
              Download .md File
            </button>
            <button
              onClick={handleReset}
              className="text-slate-500 hover:text-slate-300 hover:underline cursor-pointer"
            >
              Start Over
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
