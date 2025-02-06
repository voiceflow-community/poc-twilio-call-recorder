import { Metadata } from "next/types";
import { Inter } from 'next/font/google';
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Call Recorder Dashboard",
  description: "Dashboard for managing recorded calls",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/serviceWorker.js');
              }
            `,
          }}
        />
      </head>
      <body
        className={`${inter.variable} font-sans antialiased bg-gray-900 text-gray-100`}
        data-ryu-obtrusive-scrollbars="false"
      >
        {children}
      </body>
    </html>
  );
}
