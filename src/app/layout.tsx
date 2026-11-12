import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";

const body = Source_Sans_3({
  variable: "--font-body",
  subsets: ["latin"],
});

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
    <html lang="en" className={`${body.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
