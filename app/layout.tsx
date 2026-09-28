import type { Metadata, Viewport } from "next";
import "./globals.css";

// Static export is served under a sub-path; Next does not prefix basePath onto
// absolute metadata asset URLs, so prefix them explicitly for that build.
const assetBase = process.env.STATIC_EXPORT === "1" ? "/HKRTTrafficInfo" : "";

// Matches the app-icon plate colour so installed-app chrome, the PWA splash
// screen and the browser toolbar blend into the icon instead of clashing.
export const viewport: Viewport = {
  themeColor: "#130f0a",
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "香港實時交通資訊",
  applicationName: "香港實時交通資訊",
  description: "一站式查看全港衝紅燈攝影機、偵速攝影機、運輸署交通快拍、實時路段車速、特別交通消息、停車場空位及天文台雨量。官方開放數據，毋須登入。 | One-stop view of red-light cameras, speed cameras, traffic snapshots, live road-segment speeds, incidents, parking vacancy and HKO rainfall. Official open data.",
  manifest: `${assetBase}/site.webmanifest`,
  appleWebApp: {
    title: "香港實時交通資訊",
    capable: true,
  },
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: [
      { url: `${assetBase}/favicon-32x32.png`, sizes: "32x32", type: "image/png" },
      { url: `${assetBase}/app-icon-192.png`, sizes: "192x192", type: "image/png" },
      { url: `${assetBase}/app-icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
    shortcut: `${assetBase}/favicon-32x32.png`,
    apple: [
      { url: `${assetBase}/apple-touch-icon.png`, sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-HK">
      <body className="antialiased">{children}</body>
    </html>
  );
}
