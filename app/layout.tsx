// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// --- THIS IS THE UPDATED METADATA OBJECT ---
export const metadata: Metadata = {
  title: "Markdown Web Scraper",
  description:
    "A simple tool to recursively scrape a website's content and consolidate it into a single, clean Markdown file. Enter a URL to get started!",

  // --- Open Graph Meta Tags (for Facebook, LinkedIn, etc.) ---
  openGraph: {
    title:
      "Recursively scrape a website's content into a single Markdown file.",
    description:
      "Recursively scrape a website's content into a single Markdown file.",
    url: "https://contextscribe.vercel.app", // IMPORTANT: Replace with your actual deployed URL
    siteName: "ContextScribe",
    images: [
      {
        url: "/favicon.ico", // Points to your image in the public folder
        width: 128,
        height: 128,
        alt: "Preview image for the Markdown Web Scraper application",
      },
    ],
    locale: "en_US",
    type: "website",
  },

  // --- Twitter Card Meta Tags ---
  twitter: {
    card: "summary_large_image",
    title: "ContextScribe",
    description:
      "Recursively scrape a website's content into a single Markdown file.",
    creator: "@huy_gm", // Optional: Replace with your Twitter handle
    images: ["/favicon.ico"], // Must be an absolute URL in production
  },
};
// --- END OF METADATA OBJECT ---

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-slate-50 text-slate-800`}>
        {children}
      </body>
    </html>
  );
}
