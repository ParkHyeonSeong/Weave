import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="UTF-8" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="description" content="Weave — Project management and knowledge base" />
        <meta name="theme-color" content="#6366F1" />
        <link rel="icon" type="image/svg+xml" href="/icons/weave_square.svg" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
