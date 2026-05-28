import { useState } from 'react';
import EntityIcon from './EntityIcon';
import ColorPicker from './ColorPicker';
import IconPicker from './IconPicker';
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
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
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
              onClick={() => setPickerOpen(true)}
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

      <IconPicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={icon}
        color={color || defaultColor}
        entityType={entityType}
        entityId={entityId}
        onChange={(newIcon) => onChange({ icon: newIcon, color })}
      />
    </>
  );
}
