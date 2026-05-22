import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';
import { X, Anchor } from 'lucide-react';

export default function TrackEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, selected,
}) {
  // sourceX < targetX: 정방향. 두 노드 가로 거리가 충분하면 표준 smoothstep,
  // 가깝거나 역방향이면 offset 크게 줘서 우회.
  const dx = targetX - sourceX;
  const isBackward = dx < 80;
  const offset = isBackward ? 60 : 20;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    borderRadius: 14,
    offset,
  });

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
          className="TrackEdgeLabel"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
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
