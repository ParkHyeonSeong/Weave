import EntityIcon from './EntityIcon';
import ColorPicker from './ColorPicker';
import { DEFAULT_COLORS } from '@/library/entityAppearance';

export default function AppearanceSection({
  icon,
  color,
  entityType,            // 'branch' | 'track' | 'canvas'
  entityId,              // for upload routes (used in later slice)
  disabled = false,
  onChange,              // ({ icon, color }) => void
}) {
  const defaultColor = DEFAULT_COLORS[entityType] || DEFAULT_COLORS.branch;

  return (
    <div className="AppearanceSection">
      <div className="AppearanceSection__Preview">
        <EntityIcon
          icon={icon}
          color={color}
          size={44}
          entityType={entityType}
        />
      </div>

      <div className="AppearanceSection__Fields">
        <div className="AppearanceSection__Field">
          <label className="AppearanceSection__Label">Icon</label>
          <button
            type="button"
            className="AppearanceSection__IconBtn"
            disabled={disabled}
            onClick={() => {
              // Slice 4에서 IconPicker 모달 오픈
              alert('IconPicker는 Slice 4에서 구현됩니다.');
            }}
          >
            {icon ? 'Change icon...' : 'Choose icon...'}
          </button>
        </div>

        <div className="AppearanceSection__Field">
          <label className="AppearanceSection__Label">Color</label>
          <ColorPicker
            value={color || defaultColor}
            onChange={(c) => onChange({ icon, color: c })}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
