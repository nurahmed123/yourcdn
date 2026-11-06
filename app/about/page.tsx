import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { SITE_DESCRIPTION, SITE_NAME, siteOrigin } from "@/lib/site";

const title = "File storage and delivery from your own R2 bucket";
const canonical = siteOrigin ? `${siteOrigin}/about` : undefined;
const image = siteOrigin ? `${siteOrigin}/yourcdn-social.png` : undefined;

export const metadata: Metadata = {
  title,
  description: SITE_DESCRIPTION,
  robots: { index: Boolean(canonical), follow: Boolean(canonical) },
  ...(canonical && image
    ? {
        alternates: { canonical },
        openGraph: {
          type: "website",
          title: `${title} | ${SITE_NAME}`,
          description: SITE_DESCRIPTION,
          url: canonical,
          siteName: SITE_NAME,
          images: [
            {
              url: image,
              width: 1200,
              height: 630,
              alt: "YourCDN — Your storage, ready to share",
            },
          ],
        },
        twitter: {
          card: "summary_large_image",
          title: `${title} | ${SITE_NAME}`,
          description: SITE_DESCRIPTION,
          images: [image],
        },
      }
    : {}),
};

export default function About() {
  return (
    <main className="about-page">
      <header className="about-header">
        <Brand />
        <Link href="/login" className="button secondary">
          Sign in
        </Link>
      </header>
      <section className="about-hero" aria-labelledby="about-title">
        <h1 id="about-title">Your storage, ready to share.</h1>
        <p>{SITE_DESCRIPTION}</p>
        <Link href="/signup" className="button primary">
          Create an account
        </Link>
      </section>
      <dl className="about-features">
        <div>
          <dt>Bring your own bucket</dt>
          <dd>
            Connect a Cloudflare R2 bucket to each workspace and organize assets
            in folders.
          </dd>
        </div>
        <div>
          <dt>Upload in one request</dt>
          <dd>
            Send a file with a scoped API key and get its URL, name, and size in
            the response.
          </dd>
        </div>
        <div>
          <dt>Choose who can open a file</dt>
          <dd>
            Share public links or keep files private to authorized workspace
            members.
          </dd>
        </div>
      </dl>
    </main>
  );
}
