import Document, { Html, Head, Main, NextScript } from "next/document";

// SEC-22: Pages Router에서 nonce 기반 CSP를 쓰려면 _document가 미들웨어가 심은 x-nonce를
// 읽어 Head/NextScript에 전달해야 한다. 그래야 Next가 주입하는 스크립트(__NEXT_DATA__·런타임·
// 청크 부트스트랩)에 nonce가 붙어 script-src 'nonce-…'(unsafe-inline 없음)에서 실행된다.
// (getInitialProps 추가로 정적 최적화는 비활성 — per-request nonce엔 SSR이 필수.)
class MyDocument extends Document {
  static async getInitialProps(ctx) {
    const initialProps = await Document.getInitialProps(ctx);
    const nonce = ctx.req?.headers?.["x-nonce"] || "";
    return { ...initialProps, nonce };
  }

  render() {
    const { nonce } = this.props;
    return (
      <Html lang="en">
        <Head nonce={nonce}>
          <meta charSet="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
          <meta name="robots" content="noindex, nofollow" />
          <meta name="description" content="Weave — Project management and knowledge base" />
          <meta name="theme-color" content="#6366F1" />
          <link rel="icon" type="image/svg+xml" href="/icons/weave_square.svg" />
          <link rel="manifest" href="/manifest.json" />
          <link rel="apple-touch-icon" href="/icons/weave-192.png" />
        </Head>
        <body>
          <Main />
          <NextScript nonce={nonce} />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
