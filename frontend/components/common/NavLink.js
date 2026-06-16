import { forwardRef } from 'react';
import { useRouter } from 'next/router';
import { shouldInterceptNavClick } from '@/library/navLink';

// 내부 페이지 링크. 실제 <a href>를 렌더해 가운데클릭·ctrl/cmd-클릭·우클릭 '새 탭에서 열기'·
// URL 호버 미리보기를 브라우저가 네이티브로 처리하게 한다. 평범한 좌클릭만 가로채 SPA 라우팅
// (router.push)으로 처리하고, onClick으로 넘어온 사이드이펙트(드롭다운 닫기 등)는 그 좌클릭
// 경로에서만 실행된다(가운데클릭은 'auxclick'이라 onClick이 호출되지 않음).
//
// 전역 a { color } 규칙이 카드/행 텍스트로 번지지 않도록 .NavLink 클래스로 color를 inherit한다.
// (인라인 style이 아니라 클래스라서, 컴포넌트별 active/hover 색 규칙이 동일 specificity로 이길 수 있다.)
// consumer className은 뒤에 붙여 기존 카드/행 CSS를 유지한다.
const NavLink = forwardRef(function NavLink(
  { href, onClick, replace = false, scroll, shallow, className, children, ...rest },
  ref,
) {
  const router = useRouter();

  const handleClick = (e) => {
    // 수정자/보조 버튼 클릭(가운데·우클릭, ctrl/cmd/shift/alt)은 브라우저 기본 동작(새 탭/창)에
    // 맡기고 사이드이펙트도 실행하지 않는다 — 가로채는 평범한 좌클릭에서만 onClick을 호출한다.
    if (!shouldInterceptNavClick(e)) return;
    onClick?.(e);
    // consumer가 좌클릭 동작을 막았으면(예: 좌클릭=패널 열기) SPA 라우팅을 건너뛴다.
    // 이때도 가운데/ctrl/cmd 클릭은 위에서 위임돼 네이티브 새 탭으로 전체 페이지를 연다.
    if (e.defaultPrevented) return;
    e.preventDefault();
    router[replace ? 'replace' : 'push'](href, undefined, { scroll, shallow });
  };

  return (
    <a
      ref={ref}
      href={href}
      onClick={handleClick}
      // 앵커 기본 드래그(링크 고스트) 비활성 — 기존 <button>/<div> 카드 느낌 유지
      draggable={false}
      className={className ? `NavLink ${className}` : 'NavLink'}
      {...rest}
    >
      {children}
    </a>
  );
});

export default NavLink;
