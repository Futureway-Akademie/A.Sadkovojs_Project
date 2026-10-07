import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Manrope } from "next/font/google";
import "./globals.css";
import { SiteShell } from "@/components/site-shell";

const bodyFont = Inter({ subsets: ["latin"], variable: "--font-rw-body", display: "swap" });
const displayFont = Manrope({ subsets: ["latin"], variable: "--font-rw-display", display: "swap" });
const monoFont = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-rw-mono", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "RheinWerk Industrieservice",
    template: "%s | RheinWerk Industrieservice",
  },
  description:
    "Inspektion, Wartung sowie Diagnose und Reparatur für Pumpen, Kompressoren und industrielle Lüftungsanlagen in der Rhein-Neckar-Region.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable}`}>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
