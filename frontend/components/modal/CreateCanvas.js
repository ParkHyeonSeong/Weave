import { useState } from 'react';
import { X, Globe, Lock } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function CreateCanvas({ onClose }) {
  const [canvasName, setCanvasName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Key 입력: 대문자 영문 + 숫자만 허용, 최대 10자
  const handleKeyChange = (e) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    setKey(value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canvasName.trim() || key.length < 2 || loading) return;

    setError('');
    setLoading(true);
    try {
      const res = await axios.post('/wiki/canvases', {
        canvas_name: canvasName.trim(),
        key: key.trim(),
        description: description.trim() || null,
        visibility,
      });
      if (res.data.status) {
        // Sidebar 목록 갱신 이벤트
        window.dispatchEvent(new Event('canvas:created'));
        onClose();
      } else if (res.data.message === 'KEY_ALREADY_EXISTS') {
        setError('This key is already in use.');
      }
    } catch {
      setError('Failed to create canvas.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="CreateCanvas__Backdrop" onClick={onClose}>
      <form className="CreateCanvas" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="CreateCanvas__Header">
          <h2 className="CreateCanvas__Title">Create Canvas</h2>
          <button type="button" className="CreateCanvas__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="CreateCanvas__Body">
          <div className="CreateCanvas__Field">
            <label className="CreateCanvas__Label">Canvas name</label>
            <input
              className="CreateCanvas__Input"
              type="text"
              placeholder="e.g. Product Docs, Team Wiki"
              value={canvasName}
              onChange={(e) => setCanvasName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="CreateCanvas__Field">
            <label className="CreateCanvas__Label">Key</label>
            <input
              className="CreateCanvas__Input CreateCanvas__Input--key"
              type="text"
              placeholder="e.g. DOC, WIKI"
              value={key}
              onChange={handleKeyChange}
            />
            <span className="CreateCanvas__Hint">
              2-10 uppercase letters/numbers, starting with a letter
            </span>
          </div>

          <div className="CreateCanvas__Field">
            <label className="CreateCanvas__Label">Description</label>
            <textarea
              className="CreateCanvas__Textarea"
              placeholder="What is this canvas about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="CreateCanvas__Field">
            <label className="CreateCanvas__Label">Visibility</label>
            <div className="CreateCanvas__VisibilityGroup">
              <button
                type="button"
                className={`CreateCanvas__VisibilityBtn ${visibility === 'private' ? 'CreateCanvas__VisibilityBtn--active' : ''}`}
                onClick={() => setVisibility('private')}
              >
                <Lock size={14} />
                Private
              </button>
              <button
                type="button"
                className={`CreateCanvas__VisibilityBtn ${visibility === 'public' ? 'CreateCanvas__VisibilityBtn--active' : ''}`}
                onClick={() => setVisibility('public')}
              >
                <Globe size={14} />
                Public
              </button>
            </div>
            <span className="CreateCanvas__Hint">
              {visibility === 'private'
                ? 'Only invited members can access this canvas.'
                : 'Anyone in the workspace can view this canvas.'}
            </span>
          </div>

          {error && <div className="CreateCanvas__Error">{error}</div>}
        </div>

        <div className="CreateCanvas__Footer">
          <button type="button" className="CreateCanvas__CancelBtn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="CreateCanvas__SubmitBtn"
            disabled={!canvasName.trim() || key.length < 2 || loading}
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
