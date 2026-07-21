import type { Metadata } from "next";
import "tldraw/tldraw.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trace — A professor who can see your work",
  description:
    "Learn out loud with an AI professor that sees, draws, reads, and runs code on a shared whiteboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
