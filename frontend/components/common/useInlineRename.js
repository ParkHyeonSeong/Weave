import { useState, useRef } from 'react';

// onSave(id, newName) → Promise. 항목 라벨을 인풋으로 치환할 때 사용.
export default function useInlineRename(onSave) {
  const [editingId, setEditingId] = useState(null);
  const [value, setValue] = useState('');
  // Enter 시 submit → 인풋 언마운트 → onBlur → submit 재호출되는 이중 저장을 막는 가드.
  const doneRef = useRef(false);

  const start = (id, currentName) => {
    doneRef.current = false;
    setEditingId(id);
    setValue(currentName || '');
  };
  const cancel = () => { doneRef.current = true; setEditingId(null); setValue(''); };
  const submit = async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const v = value.trim();
    const id = editingId;
    setEditingId(null);
    if (v && id != null) await onSave(id, v);
  };

  const inputProps = {
    value,
    autoFocus: true,
    onChange: (e) => setValue(e.target.value),
    onKeyDown: (e) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    },
    onBlur: submit,
    onClick: (e) => e.stopPropagation(),
  };

  return { editingId, start, cancel, inputProps };
}
