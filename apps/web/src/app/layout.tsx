import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sophishan Clipper",
  description: "Turn long YouTube videos into captioned 9:16 shorts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
