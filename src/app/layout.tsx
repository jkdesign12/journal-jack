import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Instrument_Serif, Inter } from 'next/font/google';
import './globals.css';

/* The two faces the journal is set in: a serif for the month, and Inter for
   everything you have to read quickly. */
const serif = Instrument_Serif({ weight: '400', subsets: ['latin'], variable: '--font-instrument-serif' });
const sans = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'journal.jack',
  description: 'A month at a time: what you watched, heard, read and did.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${serif.variable} ${sans.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
