import { memo } from 'react';
import { getSmoothStepPath, BaseEdge, EdgeLabelRenderer } from '@xyflow/react';

function DeletableEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  style, markerEnd, data, selected,
}) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            className="DeletableEdge__DeleteBtn"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            onClick={(e) => {
              e.stopPropagation();
              data?.onDelete?.(id, data?.dependencyId);
            }}
          >
            X
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(DeletableEdge);
