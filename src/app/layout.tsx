import type { Metadata } from "next";
import { Signika } from "next/font/google";
import { Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const signika = Signika({
  variable: "--font-signika",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DA-INVENT — IP Address Management",
  description:
    "IPAM e inventario asset — software open source by Domarc (domarc.it). Fork pubblici: attribuzione richiesta (LICENSE).",
};

// Blocking script to set dark class before hydration, preventing FOUC and hydration mismatch
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${signika.className} ${signika.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <TooltipProvider>
          {children}
        </TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
