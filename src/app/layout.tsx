import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <meta httpEquiv="Content-Language" content="zh-CN" />
      </head>
      <body>{children}</body>
    </html>
  );
}
