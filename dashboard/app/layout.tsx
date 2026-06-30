import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Martina — PhD Tracker",
  description: "Weekly PhD research progress",
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
