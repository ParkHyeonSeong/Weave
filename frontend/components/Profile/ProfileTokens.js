import { useState, useEffect } from 'react';
import { Key, Copy, Check, Trash2, Plus } from 'lucide-react';
import { axios } from '@/library/_axios';
import ConfirmModal from '@/components/modal/ConfirmModal';

const EXPIRY_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '365 days', value: 365 },
  { label: 'Never', value: '' },
];

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

export default function ProfileTokens({ showAlert }) {
  const [tokens, setTokens] = useState([]);

  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [creating, setCreating] = useState(false);

  const [newToken, setNewToken] = useState(''); // raw token, shown once
  const [copied, setCopied] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState(null);

  useEffect(() => {
    fetchTokens();
  }, []);

  const fetchTokens = async () => {
    try {
      const res = await axios.get('/profile/tokens');
      if (res.data.status) setTokens(res.data.tokens);
    } catch {
      showAlert('Error', 'Failed to load tokens.');
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (creating) return;
    if (!name.trim()) {
      showAlert('Error', 'Token name must not be empty.');
      return;
    }
    setCreating(true);
    try {
      const body = { name: name.trim() };
      if (expiresInDays !== '') body.expires_in_days = expiresInDays;
      const res = await axios.post('/profile/tokens', body);
      if (res.data.status) {
        setNewToken(res.data.token);
        setCopied(false);
        setName('');
        fetchTokens();
      } else {
        showAlert('Error', res.data.message);
      }
    } catch {
      showAlert('Error', 'Failed to create token.');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
    } catch {
      showAlert('Error', 'Copy failed — select the token and copy manually.');
    }
  };

  const handleRevoke = async () => {
    const target = revokeTarget;
    setRevokeTarget(null);
    if (!target) return;
    try {
      const res = await axios.delete(`/profile/tokens/${target.pat_id}`);
      if (res.data.status) {
        setTokens((prev) => prev.filter((t) => t.pat_id !== target.pat_id));
      } else {
        showAlert('Error', res.data.message);
        fetchTokens();
      }
    } catch {
      showAlert('Error', 'Failed to revoke token.');
    }
  };

  return (
    <div className="Profile__Section">
      <h2 className="Profile__SectionTitle">Personal Access Tokens</h2>
      <p className="Profile__TokenIntro">
        Authenticate API clients (e.g. the Weave MCP server) without your password. Treat tokens
        like passwords.
      </p>

      {newToken && (
        <div className="Profile__TokenReveal">
          <p className="Profile__TokenRevealWarn">
            Copy this token now — you won&apos;t be able to see it again.
          </p>
          <div className="Profile__TokenRevealRow">
            <code className="Profile__TokenValue">{newToken}</code>
            <button type="button" className="Profile__TokenCopyBtn" onClick={handleCopy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button type="button" className="Profile__TokenDismiss" onClick={() => setNewToken('')}>
            Done
          </button>
        </div>
      )}

      <form className="Profile__Form" onSubmit={handleCreate}>
        <div className="Profile__Field">
          <label className="Profile__Label">Token name</label>
          <div className="Profile__InputWrap">
            <Key size={16} className="Profile__InputIcon" />
            <input
              className="Profile__Input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. MCP server"
              maxLength={100}
            />
          </div>
        </div>
        <div className="Profile__Field">
          <label className="Profile__Label">Expires</label>
          <select
            className="Profile__Input"
            value={expiresInDays}
            onChange={(e) => {
              const v = e.target.value;
              setExpiresInDays(v === '' ? '' : Number(v));
            }}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="Profile__SaveBtn" disabled={creating || !name.trim()}>
          <Plus size={16} />
          {creating ? 'Creating...' : 'Create Token'}
        </button>
      </form>

      {tokens.length > 0 && (
        <div className="Profile__TokenList">
          {tokens.map((t) => (
            <div key={t.pat_id} className="Profile__TokenItem">
              <div className="Profile__TokenItemMain">
                <span className="Profile__TokenName">{t.name}</span>
                <code className="Profile__TokenPrefix">{t.token_prefix}…</code>
              </div>
              <div className="Profile__TokenMeta">
                <span>Created {formatDate(t.created_at)}</span>
                <span>Last used {formatDate(t.last_used_at)}</span>
                <span>{t.expires_at ? `Expires ${formatDate(t.expires_at)}` : 'No expiry'}</span>
              </div>
              <button
                type="button"
                className="Profile__TokenRevokeBtn"
                onClick={() => setRevokeTarget(t)}
              >
                <Trash2 size={16} />
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={!!revokeTarget}
        title="Revoke token"
        message={revokeTarget ? `Revoke "${revokeTarget.name}"? Any client using it stops working immediately.` : ''}
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={handleRevoke}
        onClose={() => setRevokeTarget(null)}
      />
    </div>
  );
}
