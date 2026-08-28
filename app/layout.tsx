import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { BuildRecovery } from "./components/build-recovery.tsx";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches --chrome in globals.css. Kept in step by hand; there is no way to
  // read a CSS custom property from here.
  themeColor: "#10243a",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:5211";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const socialImage = new URL("/og.png", origin).toString();

  return {
    metadataBase: new URL(origin),
    title: "RootCause HME — Heavy equipment diagnostics",
    icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
    description: "Turn machine details, symptoms, and photos into an evidence-led diagnostic interview and field report.",
    openGraph: {
      title: "RootCause HME",
      description: "Find the real problem. Fix it right.",
      type: "website",
      images: [{ url: socialImage, width: 1731, height: 909, alt: "RootCause heavy equipment diagnostics" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "RootCause HME",
      description: "Find the real problem. Fix it right.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/* Renders nothing; listens for this tab's build being deployed away. */}
        <BuildRecovery />
        {children}
      </body>
    </html>
  );
}
