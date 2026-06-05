import { Search, ArrowUpDown, SlidersHorizontal, LayoutGrid, List } from 'lucide-react';

// count, query, onQuery, placeholder, sortLabel, onSort, onFilter, view('grid'|'list'), onView
export default function HomeToolbar({
  count,
  query,
  onQuery = () => {},
  placeholder = '검색…',
  sortLabel = '최근순',
  onSort,
  onFilter,
  view = 'grid',
  onView = () => {},
}) {
  return (
    <div className="HomeToolbar">
      <span className="HomeToolbar__Count">{count}</span>
      <div className="HomeToolbar__Search">
        <Search size={15} />
        <input
          value={query}
          onChange={e => onQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
      </div>
      <button className="HPill" onClick={onSort}>
        <ArrowUpDown size={13} />
        {sortLabel}
      </button>
      <button className="HPill" onClick={onFilter}>
        <SlidersHorizontal size={13} />
        필터
      </button>
      <div className="HomeToolbar__View">
        <button
          className={view === 'grid' ? 'is-on' : ''}
          onClick={() => onView('grid')}
          aria-label="그리드 보기"
        >
          <LayoutGrid size={14} />
        </button>
        <button
          className={view === 'list' ? 'is-on' : ''}
          onClick={() => onView('list')}
          aria-label="리스트 보기"
        >
          <List size={14} />
        </button>
      </div>
    </div>
  );
}
