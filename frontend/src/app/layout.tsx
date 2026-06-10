import type { Metadata } from "next";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Pythia | Autonomous Oracle",
  description: "Pythia is a continuous on-chain prediction market deployer powered by Somnia L1.",
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
  appleWebApp: {
    title: 'Pythia',
  },
};

import { Providers } from "./providers";
import BottomNav from "../components/BottomNav";
import OnboardingModal from "../components/OnboardingModal";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${spaceMono.variable}`}>
      <body>
        <Providers>
          {children}
          <BottomNav />
          <OnboardingModal />
          <Toaster 
            position="top-center"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#000',
                color: '#fff',
                fontFamily: 'var(--font-space-mono)',
                borderRadius: '0',
                border: '1px solid #fff',
              },
              success: {
                style: {
                  border: '1px solid #fff',
                  background: 'rgba(255, 255, 255, 0.08)',
                },
              },
              error: {
                style: {
                  border: '1px solid #ff3333',
                  background: 'rgba(255, 51, 51, 0.08)',
                },
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
