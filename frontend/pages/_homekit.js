/**
 * _homekit.js — 임시 데모 페이지 (Slice 0 시각 검증용)
 * 검증 완료 후 삭제 대상.
 */
import { useState } from 'react';
import {
  Inbox,
  Clock,
  AlarmClock,
  Activity,
  GitBranch,
  FileText,
  Layers,
  Link2,
  Zap,
} from 'lucide-react';

import HomeHero from '@/components/Home/shared/HomeHero';
import StatTiles from '@/components/Home/shared/StatTiles';
import ContinueStrip from '@/components/Home/shared/ContinueStrip';
import HomeToolbar from '@/components/Home/shared/HomeToolbar';
import AppCard, { AvatarSet } from '@/components/Home/shared/AppCard';
import ProgressRing from '@/components/Home/shared/ProgressRing';
import HomeSkeleton from '@/components/Home/shared/HomeSkeleton';
import HomeEmptyState from '@/components/Home/shared/HomeEmptyState';

// ---- fixture data ----
const STAT_TILES = [
  { icon: <Inbox size={16} />, label: '열린 태스크', value: 47, tone: 'primary', delta: { text: '▼6', tone: 'up' } },
  { icon: <Clock size={16} />, label: '진행 중', value: 12, tone: 'inprog' },
  { icon: <AlarmClock size={16} />, label: '이번 주 마감', value: 5, tone: 'error', delta: { text: '주의', tone: 'warn' } },
  { icon: <Activity size={16} />, label: '활성 스프린트', value: 4, tone: 'success' },
];

const RECENT_ITEMS = [
  { title: '결제 모듈 PG 연동 리팩터링', dotColor: '#1E40AF', meta: '진행 중 · 웹 결제 리뉴얼 · 2시간 전', onClick: () => {} },
  { title: '온보딩 튜토리얼 3단계 디자인 QA', dotColor: '#D97706', meta: '리뷰 · 모바일 온보딩 · 어제', onClick: () => {} },
  { title: 'ETL 스케줄러 알림 추가', dotColor: '#9CA3AF', meta: '할 일 · 데이터 파이프라인 · 3일 전', onClick: () => {} },
];

const CONTINUE_TABS = [
  { key: 'recent', label: '최근' },
  { key: 'starred', label: '별표' },
];

const MEMBERS_A = [
  { name: '관리자', color: '#5E6AD2' },
  { name: '이수민', color: '#16A34A' },
  { name: '박정훈', color: '#D97706' },
];

const MEMBERS_B = [
  { name: '최예린', color: '#8B5CF6' },
  { name: '관리자', color: '#5E6AD2' },
];

const MEMBERS_C = [
  { name: '박정훈', color: '#D97706' },
  { name: '관리자', color: '#5E6AD2' },
  { name: '김재원', color: '#16A34A' },
  { name: '정민아', color: '#8B5CF6' },
  { name: '이수민', color: '#0EA5E9' },
];

// ---- Page ----
export default function HomeKit() {
  const [query, setQuery] = useState('');
  const [view, setView] = useState('grid');
  const [activeTab, setActiveTab] = useState('recent');

  return (
    <div className="HomeMain">

      {/* Hero */}
      <HomeHero
        greeting={<>안녕하세요, 관리자님 👋</>}
        summary={
          <>
            오늘 마감 <b>5개</b> · 진행 중 <b>3개</b> · 활성 스프린트 <b>4개</b>
          </>
        }
        actions={
          <>
            <button className="HBtn HBtn--sm">⌘K 빠른 이동</button>
            <button className="HBtn HBtn--pri HBtn--sm">＋ 새 브랜치</button>
          </>
        }
      />

      {/* Stat tiles */}
      <StatTiles tiles={STAT_TILES} />

      {/* Continue strip with tabs */}
      <ContinueStrip
        title="이어서 작업하기"
        tabs={CONTINUE_TABS}
        activeTab={activeTab}
        onTab={setActiveTab}
        onMore={() => {}}
        items={RECENT_ITEMS}
      />

      <div className="HomeDivider" />

      {/* Toolbar */}
      <HomeToolbar
        count="브랜치 6"
        query={query}
        onQuery={setQuery}
        placeholder="브랜치 검색…"
        sortLabel="최근 활동순"
        onSort={() => {}}
        onFilter={() => {}}
        view={view}
        onView={setView}
      />

      {/* Card grid — 3 variants: ring / iconbox / linked-chips */}
      <div className="HGrid">

        {/* Variant 1: ProgressRing (branch style) */}
        <AppCard accent="#5E6AD2" onClick={() => {}}>
          <div className="HCard__Top">
            <ProgressRing value={68} color="#5E6AD2" />
            <div>
              <div className="HCard__Title">웹 결제 리뉴얼</div>
              <div className="HCard__Desc">PG 교체와 결제 플로우 전면 개편. 3DS 인증 포함.</div>
            </div>
          </div>
          <div className="HCard__Foot">
            <span className="HChip HChip--sprint">S-12 · 24 태스크</span>
            <AvatarSet members={MEMBERS_A} />
          </div>
        </AppCard>

        {/* Variant 2: IconBox (canvas style) */}
        <AppCard accent="#C2410C" onClick={() => {}}>
          <div className="HCard__Top">
            <div className="HCard__IconBox" style={{ background: '#FFF7ED' }}>📋</div>
            <div>
              <div className="HCard__Title">제품 기획</div>
              <div className="HCard__Desc">로드맵·PRD·리서치. 분기별 제품 의사결정 허브.</div>
            </div>
          </div>
          <div className="HCard__Foot">
            <span className="HChip HChip--doc">24 페이지</span>
            <AvatarSet members={MEMBERS_B} />
          </div>
        </AppCard>

        {/* Variant 3: Linked chips + ring (track style) */}
        <AppCard accent="#0D9488" onClick={() => {}}>
          <div className="HCard__Top">
            <ProgressRing value={64} color="#0D9488" />
            <div>
              <div className="HCard__Title">2026 상반기 OKR</div>
              <div className="HCard__Desc">전사 핵심 목표. 제품·인프라 교차 추적.</div>
            </div>
          </div>
          <div className="HCard__Linked">
            <span className="HCard__LChip"><span className="HDot" style={{ background: '#5E6AD2' }} />결제</span>
            <span className="HCard__LChip"><span className="HDot" style={{ background: '#16A34A' }} />온보딩</span>
            <span className="HCard__LChip">+2</span>
          </div>
          <div className="HCard__Foot">
            <span className="HChip HChip--sprint">52 태스크</span>
            <AvatarSet members={MEMBERS_C} />
          </div>
        </AppCard>

      </div>

      {/* Skeleton row */}
      <HomeSkeleton variant="cards" count={3} />

      {/* Empty state */}
      <HomeEmptyState
        icon={<GitBranch size={26} />}
        title="아직 브랜치가 없어요"
        desc="브랜치를 만들어 프로젝트 관리를 시작하세요."
        ctaLabel="＋ 새 브랜치"
        onCta={() => {}}
      />

    </div>
  );
}
