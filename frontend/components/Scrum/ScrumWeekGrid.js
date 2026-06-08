import { memo } from 'react';
import ScrumCell from './ScrumCell';
import { weekDates } from '@/library/isoWeek';

const WD = ['월', '화', '수', '목', '금'];
const ROWS = [['plan', '할 일'], ['gap', 'Gap']];

// memo: props(ydoc/members/isoYear/isoWeek)가 안정적이라, 보드뷰의 presence
// (connectedUsers) 갱신 re-render가 N×10 셀 트리로 전파되지 않게 차단.
function ScrumWeekGrid({ ydoc, members, isoYear, isoWeek }) {
  const dates = weekDates(isoYear, isoWeek);
  return (
    <div className="ScrumGrid">
      <div className="ScrumGrid__Row ScrumGrid__Row--head">
        <div className="ScrumGrid__Corner" />
        {WD.map((w, i) => (
          <div key={w} className="ScrumGrid__ColHead">
            <span className="ScrumGrid__Wd">{w}</span>
            <span className="ScrumGrid__Date">{dates[i].month}/{dates[i].day}</span>
          </div>
        ))}
      </div>
      {members.map((m) => (
        <div key={m.user_id} className="ScrumGrid__Person">
          <div className="ScrumGrid__PersonHead">
            <span className="ScrumGrid__Avatar">{(m.username || '?').slice(0, 1)}</span>
            <span className="ScrumGrid__PersonName">{m.username}</span>
          </div>
          {ROWS.map(([rowKey, rowLabel]) => (
            <div key={rowKey} className="ScrumGrid__Row">
              <div className="ScrumGrid__RowLabel">{rowLabel}</div>
              {WD.map((_, dayIdx) => (
                <div key={dayIdx} className="ScrumGrid__CellWrap">
                  <ScrumCell
                    ydoc={ydoc}
                    fragmentKey={`${m.user_id}:${dayIdx}:${rowKey}`}
                    placeholder=""
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default memo(ScrumWeekGrid);
