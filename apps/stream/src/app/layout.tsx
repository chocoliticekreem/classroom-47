import type { Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, Martian_Mono } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
});

const sans = Hanken_Grotesk({
  variable: "--font-sans-ui",
  subsets: ["latin"],
});

const mono = Martian_Mono({
  variable: "--font-mono-hud",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: "Classroom 47",
  description: "IRL streaming with eyes on the city around you.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-bg text-text">{children}</body>
    </html>
  );
}
