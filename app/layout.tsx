import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { Header } from "@/app/components/header";
import { getLocale } from "@/lib/i18n";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "stellwerk-ai",
  description: "Candidate-job matching on pgvector",
};

// With a theme cookie the class is rendered on the server (no flash);
// without one this script applies the system preference before paint.
const themeInitScript = `(function(){try{if(document.documentElement.classList.contains("dark"))return;var m=document.cookie.match(/(?:^|; )theme=(dark|light)/);var t=m?m[1]:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}})()`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const theme = (await cookies()).get("theme")?.value;

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased${theme === "dark" ? " dark" : ""}`}
      // Attribute-only: browser extensions and the pre-paint theme script
      // both mutate <html> attributes before hydration.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <Header locale={locale} />
        {children}
      </body>
    </html>
  );
}
