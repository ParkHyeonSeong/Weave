// 내부 네비게이션 링크의 클릭 분기 로직.
// 실제 <a href> 위에 얹어, 평범한 좌클릭만 SPA 라우팅(router.push)으로 가로채고
// 가운데/우클릭·ctrl/cmd/shift/alt 클릭은 브라우저 기본 동작(새 탭/창)에 맡긴다.
// onClick 사이드이펙트가 미리 preventDefault 했다면(예: 좌클릭은 패널 열기) 라우팅도 건너뛴다.
//
// 참고: 가운데 클릭은 최신 브라우저에서 'click'이 아니라 'auxclick'으로 발생하므로 보통 이 핸들러가
// 호출되지도 않고 앵커의 기본 동작(새 탭)이 그대로 일어난다. button 분기는 click이 들어오는 경우의 방어.
export function shouldInterceptNavClick(event) {
  if (!event) return false;
  if (event.defaultPrevented) return false;
  // button이 정의돼 있고 좌클릭(0)이 아니면 위임 (키보드 Enter 등은 button이 없을 수 있어 0으로 간주)
  if (event.button != null && event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  return true;
}
