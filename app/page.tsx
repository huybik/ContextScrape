// app/page.tsx
"use client";

import { useState, FormEvent, useRef } from "react";
import {
  FiDownload,
  FiLoader,
  FiSearch,
  FiTrash2,
  FiXCircle,
} from "react-icons/fi";

export default function HomePage() {
  const [url, setUrl] = useState("https://ai.google.dev/gemini-api/docs/");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [finalContent, setFinalContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url) {
      setError("Please enter a URL.");
      return;
    }

    handleReset();
    setIsLoading(true);

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
            if (eventData.type === "progress") {
              setProgress((prev) => [...prev, eventData.message]);
            } else if (eventData.type === "content") {
              accumulatedContent += eventData.content;
            } else if (eventData.type === "complete") {
              setFinalContent(accumulatedContent.trim());
              setIsLoading(false);
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError("Scraping was stopped by the user.");
        setFinalContent(accumulatedContent.trim());
      } else {
        setError(err.message);
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
    // *** MODIFIED FOR MARKDOWN ***
    const blob = new Blob([finalContent], {
      type: "text/markdown;charset=utf-8",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = "scraped-content.md"; // Changed file extension
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  };

  const handleReset = () => {
    setIsLoading(false);
    setProgress([]);
    setFinalContent(null);
    setError(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  return (
    <main className="container mx-auto flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <h1 className="text-4xl font-bold text-center text-slate-900">
          Markdown Web Scraper
        </h1>
        <p className="mt-2 text-center text-slate-600">
          Enter a URL to consolidate its content into a single Markdown file.
        </p>

        {finalContent !== null ? (
          <div className="mt-8 flex flex-col items-center gap-4">
            <p className="text-lg text-green-700 font-semibold">
              {isLoading ? "Scraping stopped." : "Scraping Complete!"}
            </p>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 rounded-md bg-green-600 px-6 py-3 text-white font-semibold shadow-md hover:bg-green-700 transition-all"
            >
              <FiDownload />
              Download .md File
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-2 rounded-md bg-slate-500 px-6 py-3 text-white font-semibold shadow-md hover:bg-slate-600 transition-all"
            >
              <FiTrash2 />
              Start Over
            </button>
          </div>
        ) : (
          // ... (The rest of the JSX is identical to the previous version)
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
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
                className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-6 py-3 text-white font-semibold shadow-md hover:bg-blue-700 transition-all disabled:bg-blue-400 disabled:cursor-not-allowed"
              >
                <FiSearch />
                <span>Scrape</span>
              </button>
            </div>
          </form>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-100 p-4 text-center text-red-700">
            <p>
              <strong>Notice:</strong> {error}
            </p>
          </div>
        )}

        {isLoading && (
          <div className="mt-8 w-full rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
                <FiLoader className="animate-spin" />
                Scraping in Progress...
              </h2>
              <button
                onClick={handleStop}
                className="flex items-center gap-2 rounded-md bg-red-500 px-4 py-2 text-sm text-white font-semibold shadow-md hover:bg-red-600 transition-all"
              >
                <FiXCircle />
                Stop
              </button>
            </div>
            <div className="mt-2 h-64 overflow-y-auto rounded-md bg-slate-50 p-3 text-sm text-slate-500">
              {progress.map((msg, index) => (
                <p key={index} className="animate-pulse-once">
                  {msg}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
