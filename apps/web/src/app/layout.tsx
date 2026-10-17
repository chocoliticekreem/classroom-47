import type { Metadata } from "next";
import { Instrument_Sans, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

// One sans for everything a person reads, one mono for ids, times and numbers.
const ui = Instrument_Sans({
  variable: "--font-ui",
  subsets: ["latin"],
});

const code = Spline_Sans_Mono({
  variable: "--font-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Hamyway City", template: "%s · Hamyway City" },
  description: "Hamyway City handles delivery problems and asks a person when it should.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${ui.variable} ${code.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
