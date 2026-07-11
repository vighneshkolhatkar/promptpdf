import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Newsreader({ subsets: ["latin"], variable: "--font-serif", display: "swap", style: ["italic", "normal"] });

export const metadata: Metadata = {
  title: "PromptPDF — edit PDFs by typing what you want",
  description:
    "Upload a PDF, describe the edit in plain English, and get the updated file back. Free, open, and runs mostly in your browser. Created by Vighnesh Kolhatkar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <body className="min-h-screen font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
