import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';
import { X, Anchor } from 'lucide-react';

export default function TrackEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, selected,
}) {
  // sourceX < targetX: 정방향. 두 노드 가로 거리가 충분하면 표준 smoothstep,
  // 가깝거나 역방향이면 offset 크게 줘서 우회.
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const isBackward = dx < 80;
  const offset = isBackward ? 60 : 20;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    borderRadius: 14,
    offset,
  });

  // edge 방향에 따라 라벨을 선 옆으로 빼서 선이 라벨 위를 가로지르지 않게.
  // 가로 우세 → 위쪽으로, 세로 우세 → 오른쪽으로.
  const isHorizontalDominant = Math.abs(dx) >= Math.abs(dy);
  const labelOffsetX = isHorizontalDominant ? 0 : 20;
  const labelOffsetY = isHorizontalDominant ? -14 : 0;

  const isMaterialized = data?.materialized;
  const isRelates = data?.linkType === 'relates_to';

  const baseStroke = isRelates ? '#9CA3AF' : (isMaterialized ? '#5E6AD2' : '#9CA3AF');
  const strokeWidth = isMaterialized && !isRelates ? 2.2 : 1.6;
  const dasharray = isRelates ? '6 4' : (isMaterialized ? null : '4 5');

  return (
    <>
      {/* white halo - 노드 위 지나가도 선이 끊기지 않도록 */}
      <path
        d={edgePath}
        fill="none"
        stroke="#FAFAF7"
        strokeWidth={strokeWidth + 5}
        strokeLinecap="round"
        className="TrackEdge__Halo"
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? '#5E6AD2' : baseStroke,
          strokeWidth: selected ? 2.6 : strokeWidth,
          strokeDasharray: dasharray,
          strokeLinecap: 'round',
        }}
        markerEnd={isRelates ? undefined : 'url(#track-arrow)'}
      />
      <EdgeLabelRenderer>
        <div
          className={`TrackEdgeLabel ${selected ? 'TrackEdgeLabel--selected' : ''}`}
          // edge 방향에 따라 라벨을 선 옆으로 빼서 선이 라벨을 가리지 않게.
          style={{
            transform: `translate(-50%, -50%) translate(${labelX + labelOffsetX}px, ${labelY + labelOffsetY}px)`,
          }}
        >
          {isMaterialized && !isRelates && (
            <span className="TrackEdgeLabel__Badge" title="Materialized as real dependency">
              <Anchor size={9} />
              <span>dep</span>
            </span>
          )}
          {isRelates && (
            <span className="TrackEdgeLabel__Badge TrackEdgeLabel__Badge--rel">
              relates
            </span>
          )}
          {!isMaterialized && !isRelates && (
            <span className="TrackEdgeLabel__Badge TrackEdgeLabel__Badge--draft">
              draft
            </span>
          )}
          <button
            className="TrackEdgeLabel__DeleteBtn"
            onClick={(e) => {
              e.stopPropagation();
              data?.onDelete?.(data?.linkId);
            }}
            title="Delete link"
          >
            <X size={10} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
