import type { Metadata } from "next";
import { SITE_DESCRIPTION, SITE_NAME, siteOrigin } from "@/lib/site";
import NextTopLoader from "nextjs-toploader";
import "@fontsource-variable/dm-sans";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  applicationName: SITE_NAME,
  description: SITE_DESCRIPTION,
  ...(siteOrigin ? { metadataBase: new URL(siteOrigin) } : {}),
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
