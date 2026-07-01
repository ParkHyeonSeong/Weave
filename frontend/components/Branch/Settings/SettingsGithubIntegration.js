import { useState, useEffect } from 'react';
import { Github, Plus, Power, Trash2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getErrorCode } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

export default function SettingsGithubIntegration({ branchId, isAdmin }) {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [repo, setRepo] = useState('');
  const [installationId, setInstallationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const fetchIntegrations = async () => {
    if (!branchId) return;
    try {
      const res = await axios.get(`/branches/${branchId}/github`);
      if (res.data.status) setIntegrations(res.data.integrations || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchIntegrations(); }, [branchId]);

  const handleConnect = async () => {
    const repoName = repo.trim();
    const instId = installationId.trim();
    if (!repoName || !instId || saving) return;
    setSaving(true);
    setErr('');
    try {
      const res = await axios.post(`/branches/${branchId}/github`, {
        repo_full_name: repoName,
        installation_id: Number(instId),
      });
      if (res.data.status) {
        setRepo('');
        setInstallationId('');
        setShowAdd(false);
        await fetchIntegrations();
      } else {
        const code = getErrorCode(res.data);
        setErr(errorText(code, res.data.category) || '연결에 실패했어요.');
      }
    } catch {
      setErr('연결에 실패했어요.');
    }
    setSaving(false);
  };

  const handleToggle = async (integration) => {
    try {
      const res = await axios.patch(
        `/branches/${branchId}/github/${integration.integration_id}`,
        { enabled: !integration.enabled },
      );
      if (res.data.status) await fetchIntegrations();
    } catch {}
  };

  const handleDisconnect = async (integration) => {
    try {
      const res = await axios.delete(
        `/branches/${branchId}/github/${integration.integration_id}`,
      );
      if (res.data.status) await fetchIntegrations();
    } catch {}
  };

  if (loading) {
    return <div className="SettingsGithub__Empty">Loading…</div>;
  }

  return (
    <div className="SettingsGithub">
      <div className="SettingsGithub__Intro">
        <Github size={16} />
        <span>
          GitHub repo를 연결하면 PR의 <code>{'<KEY>-<번호>'}</code> 참조로 태스크가 자동
          연결되고, PR 열림→진행 중·머지→완료로 상태가 전환돼요.
        </span>
      </div>

      {integrations.length === 0 ? (
        <div className="SettingsGithub__Empty">연결된 repo가 없어요.</div>
      ) : (
        <div className="SettingsGithub__List">
          {integrations.map((it) => (
            <div key={it.integration_id} className="SettingsGithub__Item">
              <div className="SettingsGithub__ItemInfo">
                <span className="SettingsGithub__Repo">{it.repo_full_name}</span>
                <span className="SettingsGithub__InstId">installation #{it.installation_id}</span>
              </div>
              <span
                className={`SettingsGithub__State ${it.enabled ? 'SettingsGithub__State--on' : 'SettingsGithub__State--off'}`}
              >
                {it.enabled ? 'Enabled' : 'Disabled'}
              </span>
              {isAdmin && (
                <div className="SettingsGithub__ItemActions">
                  <button
                    className="SettingsGithub__ActionBtn"
                    onClick={() => handleToggle(it)}
                    title={it.enabled ? 'Disable' : 'Enable'}
                  >
                    <Power size={14} />
                  </button>
                  <button
                    className="SettingsGithub__ActionBtn SettingsGithub__ActionBtn--danger"
                    onClick={() => handleDisconnect(it)}
                    title="Disconnect"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        showAdd ? (
          <div className="SettingsGithub__AddForm">
            <input
              className="SettingsGithub__Input"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="org/repo"
            />
            <input
              className="SettingsGithub__Input"
              value={installationId}
              onChange={(e) => setInstallationId(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="installation_id (숫자)"
              inputMode="numeric"
            />
            {err && <span className="SettingsGithub__Error">{err}</span>}
            <div className="SettingsGithub__AddActions">
              <button
                className="SettingsGithub__SubmitBtn"
                onClick={handleConnect}
                disabled={!repo.trim() || !installationId.trim() || saving}
              >
                {saving ? 'Connecting…' : 'Connect'}
              </button>
              <button
                className="SettingsGithub__CancelBtn"
                onClick={() => { setShowAdd(false); setErr(''); }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="SettingsGithub__AddBtn" onClick={() => setShowAdd(true)}>
            <Plus size={14} />
            Connect a repository
          </button>
        )
      )}
    </div>
  );
}
