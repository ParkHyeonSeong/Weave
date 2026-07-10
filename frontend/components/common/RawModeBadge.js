import { AlertTriangle } from 'lucide-react';
import { formatUnsupportedWarning } from '@/library/rawMode';

// raw 토글 진입 시 손실 경고 / 파싱 실패(방어) 인라인 배지 — 무음 드롭 금지 원칙
export default function RawModeBadge({ warnings, parseError }) {
  const warnText = formatUnsupportedWarning(warnings);
  if (!parseError && !warnText) return null;
  return (
    <div className={`RawModeBadge${parseError ? ' RawModeBadge--error' : ''}`}>
      <AlertTriangle size={12} />
      <span>
        {parseError
          ? 'markdown을 해석하지 못해 저장이 차단되었습니다. 내용을 확인해 주세요.'
          : warnText}
      </span>
    </div>
  );
}
