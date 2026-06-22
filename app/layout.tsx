import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StudioStake — a commitment bond against dropping out",
  description:
    "Patch a small USDC bond into a course of lessons. Every lesson the tutor confirms returns a micro-slice to you; muted lessons sum to a shared return bus. Per-lesson micro-refunds settled by agents — only sane on ARC.",
  keywords: "StudioStake, ARC, USDC, staking, commitment, education, dropout, agentic, payments, web3",
};

export const viewport: Viewport = { themeColor: "#0b0c0f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
