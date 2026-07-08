import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Abbode Cropper',
  description: 'Batch product-image cropping with detection, QC, and manual touch-up',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
