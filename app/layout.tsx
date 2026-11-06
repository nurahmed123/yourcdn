import type { Metadata } from "next";
import NextTopLoader from "nextjs-toploader";
import "@fontsource-variable/dm-sans";
import "./globals.css";
export const metadata: Metadata = {
  title: "Arionys CDN — Your file workspace",
  description: "Manage, store, and deliver your files with Arionys CDN.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <NextTopLoader
          color="#7360ce"
          height={3}
          showSpinner={false}
          shadow={false}
          zIndex={10000}
        />
        {children}
      </body>
    </html>
  );
}
