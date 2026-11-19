import type { Metadata, Viewport } from 'next';
import { DM_Sans, Fraunces, Nunito } from 'next/font/google';
import { AuthDialog } from '@/components/auth';
import { Nav } from '@/components/Nav';
import './globals.css';

const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });
const nunito = Nunito({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-nunito', display: 'swap' });
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Calmling — one life, live',
  description: 'One autonomous Calmling. One persistent life. The whole world watching.',
};

export const viewport: Viewport = { themeColor: '#1f1833', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${nunito.variable} ${dmSans.variable}`}>
      <body className="min-h-dvh">
        <Nav />
        {children}
        <AuthDialog />
      </body>
    </html>
  );
}
