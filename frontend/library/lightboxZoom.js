// scale을 [min, max]로 제한
export function clampScale(scale, min, max) {
  return Math.min(max, Math.max(min, scale));
}

// 100%(1:1) 배율 = 자연 너비 / 현재 fit 렌더 너비
export function getOneToOneScale(naturalWidth, fitWidth) {
  if (!fitWidth) return 1;
  return naturalWidth / fitWidth;
}

// 포인터 지점을 고정한 채 새 배율로 줌. pointer는 변환 원점(스테이지 중심) 기준 좌표.
// t' = p - (s'/s) * (p - t)
export function zoomAtPoint(state, newScale, pointer) {
  const ratio = newScale / state.scale;
  return {
    scale: newScale,
    tx: pointer.x - ratio * (pointer.x - state.tx),
    ty: pointer.y - ratio * (pointer.y - state.ty),
  };
}
