import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Video Meetings',
  description: 'Платформа видеоконференций — фронтенд на Next.js + HeroUI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
