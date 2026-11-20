import type { Metadata, Viewport } from 'next';
import '@fontsource/shippori-mincho/latin-500.css';
import '@fontsource/shippori-mincho/latin-700.css';
import '@fontsource/shippori-mincho/latin-800.css';
import '@fontsource/shippori-mincho/japanese-500.css';
import '@fontsource/shippori-mincho/japanese-700.css';
import '@fontsource/zen-kaku-gothic-new/latin-400.css';
import '@fontsource/zen-kaku-gothic-new/latin-500.css';
import '@fontsource/zen-kaku-gothic-new/latin-700.css';
import './globals.css';
import { GAME_NAME, GAME_SUBTITLE, GAME_TAGLINE } from '@/game/config';
import { ToastProvider } from '@/components/toast';

export const metadata: Metadata = {
  title: {
    default: `${GAME_NAME}: ${GAME_SUBTITLE}`,
    template: `%s · ${GAME_NAME}`,
  },
  description: `${GAME_TAGLINE} A persistent multiplayer grand strategy game of the warring provinces.`,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#15120e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
