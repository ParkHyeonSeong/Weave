import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useUiPrefs } from '@/library/UiPrefsContext';
import { processHomeList, initialFilters } from '@/library/homeListControls';

// config: { appKey, hiddenApp, idField, queryFields, sortOptions, filterConfig, defaultView }
// 반환: { processed, view, query, toolbarProps }
export default function useHomeListControls(config, items) {
  const { prefs, loaded, isHidden, setHomeCtl } = useUiPrefs();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(config.sortOptions[0].key);
  const [view, setView] = useState(config.defaultView || 'grid');
  const [filters, setFilters] = useState(() => initialFilters(config.filterConfig));
  const appliedRef = useRef(false);

  // ui_prefs 로드 완료 시 1회만 적용 (이후 사용자가 바꾼 값은 덮어쓰지 않음).
  // persisted를 effect 내부에서 읽어 prefs 객체 정체성 변화에 영향받지 않게 한다.
  useEffect(() => {
    if (appliedRef.current || !loaded) return;
    appliedRef.current = true;
    const persisted = prefs.homeControls?.[config.appKey];
    if (persisted?.sort && config.sortOptions.some((o) => o.key === persisted.sort)) {
      setSortKey(persisted.sort);
    }
    if (persisted?.view === 'list' || persisted?.view === 'grid') {
      setView(persisted.view);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 로드 완료 시 1회만 의도
  }, [loaded]);

  const onSortKey = useCallback((key) => {
    setSortKey(key);
    setHomeCtl(config.appKey, { sort: key });
  }, [setHomeCtl, config.appKey]);

  const onView = useCallback((v) => {
    setView(v);
    setHomeCtl(config.appKey, { view: v });
  }, [setHomeCtl, config.appKey]);

  // config는 각 홈에서 모듈 레벨 const로 전달(안정적 정체성) → deps에 통째로 넣어도 안전.
  const processed = useMemo(() => processHomeList({
    items, isHidden,
    hiddenApp: config.hiddenApp, idField: config.idField,
    filters, filterConfig: config.filterConfig,
    query, queryFields: config.queryFields,
    sortKey, sortOptions: config.sortOptions,
  }), [items, isHidden, filters, query, sortKey, config]);

  return {
    processed,
    view,
    query,
    toolbarProps: {
      query,
      onQuery: setQuery,
      sortOptions: config.sortOptions,
      sortKey,
      onSortKey,
      filterConfig: config.filterConfig,
      filters,
      onFilters: setFilters,
      view,
      onView,
    },
  };
}
