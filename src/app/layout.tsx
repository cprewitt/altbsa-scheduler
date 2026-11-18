import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ALTBSA Anchor Scheduler",
  description:
    "Book Cages and Court at the ALTBSA Anchor facility. Coaches self-serve; open slots auto-confirm.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
