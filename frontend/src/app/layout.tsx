import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ZonWiki",
  description: "個人筆記本，網頁版",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-Hant"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[var(--rule)] py-6 mt-12">
          <div className="max-w-6xl mx-auto px-6 text-sm text-[var(--ink-mute)] flex justify-between">
            <span>ZonWiki · 個人筆記本</span>
            <span className="font-mono text-xs">file as source of truth</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
