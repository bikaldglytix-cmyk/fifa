import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/auth';
import { Nav } from '../components/nav';

export const metadata: Metadata = {
  title: 'FIFA 2026 World Cup Simulator',
  description:
    'Where Data Meets Destiny — simulate the real 2026 World Cup, manage your fantasy nation, predict every match.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#fafaf9',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {/* Outfit loads at runtime (build-time font fetching fails on this
            network); React hoists these to <head>, system stack is fallback */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300..800&display=swap" rel="stylesheet" />
        <AuthProvider>
          <Nav />
          <main className="mx-auto max-w-7xl px-4 pb-16 pt-6">{children}</main>
        </AuthProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}`,
          }}
        />
      </body>
    </html>
  );
}
