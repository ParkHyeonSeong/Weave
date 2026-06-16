import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { FileText, FileEdit, Star } from 'lucide-react';
import { axios } from '@/library/_axios';
import EntityIcon from '@/components/common/EntityIcon';
import HomeHero from '@/components/Home/shared/HomeHero';
import StatTiles from '@/components/Home/shared/StatTiles';
import ContinueStrip from '@/components/Home/shared/ContinueStrip';
import HomeToolbar from '@/components/Home/shared/HomeToolbar';
import HomeSkeleton from '@/components/Home/shared/HomeSkeleton';
import HomeEmptyState from '@/components/Home/shared/HomeEmptyState';
import AppCard, { AvatarSet } from '@/components/Home/shared/AppCard';
import { useUiPrefs } from '@/library/UiPrefsContext';
import useHomeListControls from '@/library/useHomeListControls';
import { byTextAsc, byNumberDesc, byDateDesc, ROLE_GROUP } from '@/library/homeListControls';
import useContextMenu from '@/components/common/useContextMenu';
import ContextMenu from '@/components/common/ContextMenu';
import { buildSpaceMenu } from '@/components/Layout/spaceMenu';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { showToast } from '@/components/Layout/Toast';

const DEFAULT_DOC_COLOR = '#16A34A';

const getRelativeTime = (dateStr) => {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 172800) return '어제';
  return `${Math.floor(diff / 86400)}일 전`;
};

const getMyName = () => {
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    return profile.username || '';
  } catch {
    return '';
  }
};

// Low-alpha tint of a #RRGGBB hex for the icon box background.
const tintOf = (hex) => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return 'rgba(94,106,210,.10)';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},.12)`;
};

const createCanvas = () => window.dispatchEvent(new CustomEvent('layout:create-canvas'));
const openCommandPalette = () => window.dispatchEvent(new CustomEvent('layout:open-search'));

const CANVAS_CONTROLS = {
  appKey: 'canvas',
  hiddenApp: 'canvases',
  idField: 'canvas_id',
  queryFields: ['canvas_name'],
  defaultView: 'grid',
  sortOptions: [
    { key: 'edited', label: '최근 편집순', compare: byDateDesc('last_edited_at') },
    { key: 'name', label: '이름순', compare: byTextAsc('canvas_name') },
    { key: 'created', label: '최근 생성순', compare: byDateDesc('created_at') },
    { key: 'pages', label: '페이지순', compare: byNumberDesc('page_count') },
  ],
  filterConfig: {
    groups: [
      ROLE_GROUP,
      {
        key: 'link', label: '브랜치 연결', options: [
          { value: 'all', label: '전체', test: () => true },
          { value: 'linked', label: '연결됨', test: (it) => it.branch_id != null },
          { value: 'standalone', label: '독립', test: (it) => it.branch_id == null },
        ],
      },
    ],
    showHidden: true,
  },
};

export default function CanvasHome() {
  const router = useRouter();
  const { isHidden, hide, unhide } = useUiPrefs();
  const ctx = useContextMenu();
  const [leaveTarget, setLeaveTarget] = useState(null);
  const [canvases, setCanvases] = useState([]);
  const { processed, view, query, toolbarProps } = useHomeListControls(CANVAS_CONTROLS, canvases);
  const [recentDocs, setRecentDocs] = useState([]);
  const [starredDocs, setStarredDocs] = useState([]);
  const [stats, setStats] = useState(null);
  const [activeTab, setActiveTab] = useState('recent');
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState('');

  const fetchCanvases = async () => {
    try {
      const res = await axios.get('/canvases');
      if (res.data.status) setCanvases(res.data.canvases);
    } catch {}
  };

  const fetchWidgetData = async () => {
    try {
      const [recentRes, starRes] = await Promise.all([
        axios.get('/recent-views', { params: { type: 'doc', limit: 8 } }),
        axios.get('/stars', { params: { type: 'doc', limit: 8 } }),
      ]);
      if (recentRes.data.status) setRecentDocs(recentRes.data.items);
      if (starRes.data.status) setStarredDocs(starRes.data.items);
    } catch {}
  };

  const fetchStats = async () => {
    try {
      const res = await axios.get('/canvases/home-stats');
      if (res.data.status) setStats(res.data);
    } catch {}
  };

  useEffect(() => {
    setMe(getMyName());
    (async () => {
      await Promise.all([fetchCanvases(), fetchWidgetData(), fetchStats()]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const handleRefresh = () => fetchCanvases();
    window.addEventListener('canvas:created', handleRefresh);
    return () => window.removeEventListener('canvas:created', handleRefresh);
  }, []);

  const openCardMenu = (e, c) => {
    const id = c.canvas_id;
    const detailPath = `/canvas/${id}`;
    const settingsPath = `${detailPath}/settings`;
    ctx.open(e, buildSpaceMenu(
      {
        appType: 'canvas',
        id,
        name: c.canvas_name,
        role: c.my_role,
        isHidden: isHidden('canvases', id),
      },
      {
        open: () => router.push(detailPath),
        openNewTab: () => window.open(detailPath, '_blank'),
        settings: () => router.push(settingsPath),
        rename: () => router.push(settingsPath),
        members: () => router.push(settingsPath),
        toggleHide: () => (isHidden('canvases', id) ? unhide('canvases', id) : hide('canvases', id)),
        archive: async () => {
          try {
            const res = await axios.delete(`/canvases/${id}`);
            if (res.data.status) {
              fetchCanvases();
              window.dispatchEvent(new Event('canvas:created'));
              showToast(`"${c.canvas_name}" 아카이브됨`);
            } else {
              showToast('아카이브 실패', 'error');
            }
          } catch {}
        },
        leave: () => setLeaveTarget({ id, name: c.canvas_name }),
      },
    ));
  };

  const stripDocs = activeTab === 'starred' ? starredDocs : recentDocs;
  const stripItems = stripDocs.map((it) => ({
    title: it.title,
    dotColor: it.color || DEFAULT_DOC_COLOR,
    meta: `${it.canvas_name} · ${getRelativeTime(it.viewed_at || it.starred_at)}`,
    href: `/canvas/${it.canvas_id}/${it.page_id}`,
  }));

  return (
    <>
    <div className="HomeMain">
      <HomeHero
        greeting={me ? <>안녕하세요, {me}님 👋</> : <>문서 작업을 이어가 볼까요 👋</>}
        summary={stats && (
          <>
            이번 주 편집 <b>{stats.edited_this_week}</b> · 별표{' '}
            <b>{stats.starred_count}</b>
          </>
        )}
        actions={
          <>
            <button className="HBtn HBtn--sm" onClick={openCommandPalette}>
              ⌘K 빠른 이동
            </button>
            <button className="HBtn HBtn--sm" onClick={() => router.push('/canvas/archive')}>
              🗄 보관함
            </button>
            <button className="HBtn HBtn--pri HBtn--sm" onClick={createCanvas}>
              ＋ 새 문서
            </button>
          </>
        }
      />

      <StatTiles
        loading={!stats}
        tiles={stats ? [
          { icon: <FileText size={16} />, label: '전체 문서', value: stats.total_docs, tone: 'doc' },
          { icon: <FileEdit size={16} />, label: '이번 주 편집', value: stats.edited_this_week, tone: 'primary' },
          { icon: <Star size={16} />, label: '별표 문서', value: stats.starred_count, tone: 'warn' },
        ] : []}
      />

      <ContinueStrip
        title="이어서 작업하기"
        tabs={[
          { key: 'recent', label: '최근' },
          { key: 'starred', label: '별표' },
        ]}
        activeTab={activeTab}
        onTab={setActiveTab}
        loading={loading}
        items={stripItems}
        emptyText={activeTab === 'starred' ? '별표한 문서가 없습니다' : '최근 본 문서가 없습니다'}
      />

      <div className="HomeDivider" />

      <HomeToolbar
        count={`캔버스 ${processed.length}`}
        placeholder="문서·캔버스 검색…"
        {...toolbarProps}
      />

      {loading ? (
        <HomeSkeleton variant="cards" />
      ) : processed.length === 0 ? (
        <HomeEmptyState
          icon={<FileText size={26} />}
          title={canvases.length === 0 ? '아직 캔버스가 없어요' : (query.trim() ? '검색 결과 없음' : '표시할 캔버스가 없어요')}
          desc={
            canvases.length === 0
              ? '캔버스를 만들어 문서 작업을 시작하세요.'
              : `"${query}"에 맞는 캔버스가 없습니다.`
          }
          ctaLabel={canvases.length === 0 ? '＋ 새 캔버스' : undefined}
          onCta={createCanvas}
        />
      ) : (
        <div className={view === 'list' ? 'HList' : 'HGrid'}>
          {processed.map((c) => (
            <AppCard
              key={c.canvas_id}
              accent={c.color}
              href={`/canvas/${c.canvas_id}`}
              onContextMenu={(e) => openCardMenu(e, c)}
            >
              <div className="HCard__Top">
                <div className="HCard__IconBox" style={{ background: tintOf(c.color) }}>
                  <EntityIcon icon={c.icon} color={c.color} size={24} entityType="canvas" />
                </div>
                <div>
                  <div className="HCard__Title">{c.canvas_name}</div>
                  <div className="HCard__Desc">{c.description}</div>
                </div>
              </div>
              <div className="HCard__Foot">
                <span className="HChip HChip--doc">{c.page_count ?? 0} 페이지</span>
                <AvatarSet members={c.contributors || []} />
              </div>
              {c.last_edited_at && (
                <div className="CanvasHome__Edited">
                  {getRelativeTime(c.last_edited_at)} 편집
                </div>
              )}
            </AppCard>
          ))}
        </div>
      )}
    </div>

      <ContextMenu {...ctx.props} />
      <ConfirmModal
        isOpen={!!leaveTarget}
        onClose={() => setLeaveTarget(null)}
        onConfirm={async () => {
          const t = leaveTarget;
          setLeaveTarget(null);
          try {
            const res = await axios.post(`/canvases/${t.id}/leave`);
            if (res.data.status) {
              fetchCanvases();
              window.dispatchEvent(new Event('canvas:created'));
            } else {
              showToast('나가기 실패', 'error');
            }
          } catch {}
        }}
        title="캔버스 나가기"
        message={`"${leaveTarget?.name}"에서 나가시겠습니까?`}
        confirmLabel="나가기"
        variant="danger"
      />
    </>
  );
}
