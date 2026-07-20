import type { Metadata } from "next";
import "./globals.css";

// LEARNING NOTE: The scaffold used next/font to load Google Fonts at build
// time, but our build environment has no access to fonts.googleapis.com.
// A well-chosen system font stack (set in globals.css) costs zero network
// requests and looks native on every OS — a respectable production choice,
// not just a fallback.

export const metadata: Metadata = {
  title: "Wayfarer — trips that fit you",
  description:
    "Answer five quick questions and get travel destinations matched to how you actually like to travel.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        {children}
      </body>
    </html>
  );
}
