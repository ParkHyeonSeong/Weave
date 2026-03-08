import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '@/components/Admin/AdminLayout';
import { axios } from '@/library/_axios';
import { Blocks, Bot } from 'lucide-react';
import Alert from '@/components/modal/Alert';

export default function IntegrationsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // AI Config 상태
  const [aiProvider, setAiProvider] = useState('anthropic');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiKeyPlaceholder, setAiKeyPlaceholder] = useState('');
  const [aiSaving, setAiSaving] = useState(false);

  // Alert 상태
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const showAlert = (title, message) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertOpen(true);
  };

  useEffect(() => {
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      if (profile.role !== 'admin') {
        router.replace('/');
        return;
      }
    } catch {
      router.replace('/');
      return;
    }
    fetchAiConfig();
  }, []);

  const fetchAiConfig = async () => {
    try {
      const res = await axios.get('/ai/config');
      if (res.data.status && res.data.config) {
        const cfg = res.data.config;
        setAiProvider(cfg.provider || 'anthropic');
        setAiModel(cfg.model || '');
        if (cfg.api_key) {
          setAiApiKey('');
          setAiKeyPlaceholder(cfg.api_key);
        }
      }
    } catch {
      // Config not set yet
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAiConfig = async () => {
    if (!aiApiKey && !aiKeyPlaceholder) {
      showAlert('Error', 'Please enter an API key.');
      return;
    }
    setAiSaving(true);
    try {
      const defaultModel = aiProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o';
      const body = { provider: aiProvider, model: aiModel || defaultModel };
      if (aiApiKey) {
        body.api_key = aiApiKey;
      }
      const res = await axios.put('/ai/config', body);
      if (res.data.status) {
        showAlert('Success', 'AI configuration saved successfully.');
        fetchAiConfig();
      } else {
        showAlert('Error', res.data.message || 'Failed to save configuration.');
      }
    } catch {
      showAlert('Error', 'Failed to save AI configuration.');
    } finally {
      setAiSaving(false);
    }
  };

  if (loading) return null;

  return (
    <AdminLayout>
      <div className="Admin">
        <div className="Admin__Header">
          <Blocks size={20} />
          <h1 className="Admin__Title">Integrations</h1>
        </div>

        <div className="Admin__Section">
          <div className="Admin__SectionHeader">
            <h2 className="Admin__SectionTitle">
              <Bot size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
              AI Assistant
            </h2>
          </div>
          <p className="Admin__Description">
            Configure the AI provider and model for the AI Assistant on the Dashboard.
          </p>

          <div className="Admin__Form">
            <div className="Admin__Field">
              <label className="Admin__Label">Provider</label>
              <select
                className="Admin__Select"
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">API Key</label>
              <input
                className="Admin__Input"
                type="password"
                value={aiApiKey}
                placeholder={aiKeyPlaceholder || 'Enter API key'}
                onChange={(e) => setAiApiKey(e.target.value)}
                onFocus={() => setAiApiKey('')}
              />
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">Model</label>
              <input
                className="Admin__Input"
                type="text"
                value={aiModel}
                placeholder={aiProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'}
                onChange={(e) => setAiModel(e.target.value)}
              />
            </div>

            <button
              className="Admin__SaveBtn"
              onClick={handleSaveAiConfig}
              disabled={aiSaving}
            >
              {aiSaving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </div>

      <Alert
        isOpen={alertOpen}
        title={alertTitle}
        contents={alertMessage}
        onClose={() => setAlertOpen(false)}
      />
    </AdminLayout>
  );
}
