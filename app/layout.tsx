import type { Metadata } from "next";
import { Spectral, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const serif = Spectral({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  weight: ["400", "500", "600"],
  style: ["italic", "normal"],
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "PromptPDF — edit PDFs by typing what you want",
  description:
    "Upload a PDF, describe the edit in plain English, and get the updated file back. Free, open, and runs mostly in your browser. Created by Vighnesh Kolhatkar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen font-mono text-ink antialiased">{children}</body>
    </html>
  );
}
