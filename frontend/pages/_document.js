import Document, { Html, Head, Main, NextScript } from "next/document";

// SEC-22: Pages Router에서 nonce 기반 CSP를 쓰려면 _document가 미들웨어가 심은 x-nonce를
// 읽어 Head/NextScript에 전달해야 한다. 그래야 Next가 주입하는 스크립트(__NEXT_DATA__·런타임·
// 청크 부트스트랩)에 nonce가 붙어 script-src 'nonce-…'(unsafe-inline 없음)에서 실행된다.
// (getInitialProps 추가로 정적 최적화는 비활성 — per-request nonce엔 SSR이 필수.)
// ⚠️ 주의: getInitialProps는 ASO(정적 최적화)를 끄지 않는다 — Next의 정적 판정은 페이지
// 컴포넌트의 데이터 훅 기준이라 이 앱처럼 데이터 훅이 없으면 전 페이지가 정적 프리렌더되고,
// 그 HTML의 nonce는 빈 값으로 박제된다. 실행형 인라인 <script nonce>는 절대 추가하지 말 것
// (prod CSP에 차단됨) — 테마 부트스트랩이 /public/theme-boot.js 외부 파일인 이유도 이것.
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
          {/* theme-color는 부트스트랩보다 앞 — 스크립트가 첫 페인트 전에 attr+meta를 함께 동기한다. */}
          <meta name="theme-color" content="#FFFFFF" />
          {/* 테마 부트스트랩 — 외부 parser-blocking 파일(script-src 'self' 통과).
              인라인+nonce는 ASO 정적 HTML에서 nonce가 비어 prod CSP에 차단되므로 금지. */}
          <script src="/theme-boot.js" />
          <meta charSet="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
          <meta name="robots" content="noindex, nofollow" />
          <meta name="description" content="Weave — Project management and knowledge base" />
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
