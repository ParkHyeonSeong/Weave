import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AdminLayout from '@/components/Admin/AdminLayout';
import { axios } from '@/library/_axios';
import { Blocks, Bot, Mail } from 'lucide-react';
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

  // SMTP Config 상태
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpPasswordPlaceholder, setSmtpPasswordPlaceholder] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [senderName, setSenderName] = useState('');
  const [useTls, setUseTls] = useState(true);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);

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
    fetchSmtpConfig();
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

  const fetchSmtpConfig = async () => {
    try {
      const res = await axios.get('/admin/smtp-config');
      if (res.data.status && res.data.config) {
        const cfg = res.data.config;
        setSmtpHost(cfg.smtp_host || '');
        setSmtpPort(String(cfg.smtp_port || 587));
        setSmtpUser(cfg.smtp_user || '');
        setSenderEmail(cfg.sender_email || '');
        setSenderName(cfg.sender_name || '');
        setUseTls(cfg.use_tls !== false);
        if (cfg.smtp_password) {
          setSmtpPassword('');
          setSmtpPasswordPlaceholder(cfg.smtp_password);
        }
      }
    } catch {
      // Config not set yet
    }
  };

  const handleSaveSmtpConfig = async () => {
    if (!smtpHost || !smtpUser || !senderEmail) {
      showAlert('Error', 'Please fill in all required fields.');
      return;
    }
    if (!smtpPassword && !smtpPasswordPlaceholder) {
      showAlert('Error', 'Please enter an SMTP password.');
      return;
    }
    setSmtpSaving(true);
    try {
      const body = {
        smtp_host: smtpHost,
        smtp_port: parseInt(smtpPort) || 587,
        smtp_user: smtpUser,
        sender_email: senderEmail,
        sender_name: senderName,
        use_tls: useTls,
      };
      if (smtpPassword) {
        body.smtp_password = smtpPassword;
      }
      const res = await axios.put('/admin/smtp-config', body);
      if (res.data.status) {
        showAlert('Success', 'SMTP configuration saved successfully.');
        fetchSmtpConfig();
      } else {
        showAlert('Error', res.data.message || 'Failed to save configuration.');
      }
    } catch {
      showAlert('Error', 'Failed to save SMTP configuration.');
    } finally {
      setSmtpSaving(false);
    }
  };

  const handleTestSmtp = async () => {
    setSmtpTesting(true);
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      const res = await axios.post('/admin/smtp-config/test', {
        test_email: profile.email || senderEmail,
      });
      if (res.data.status) {
        showAlert('Success', `Test email sent to ${profile.email || senderEmail}.`);
      } else {
        showAlert('Error', res.data.message || 'Failed to send test email.');
      }
    } catch {
      showAlert('Error', 'Failed to send test email.');
    } finally {
      setSmtpTesting(false);
    }
  };

  if (loading) return null;

  return (
    <AdminLayout>
      <Head>
        <title>Integrations - Weave</title>
      </Head>
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
        <div className="Admin__Section">
          <div className="Admin__SectionHeader">
            <h2 className="Admin__SectionTitle">
              <Mail size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
              Email (SMTP)
            </h2>
          </div>
          <p className="Admin__Description">
            Configure SMTP settings for sending emails (password resets, notifications).
          </p>

          <div className="Admin__Form">
            <div className="Admin__Field">
              <label className="Admin__Label">SMTP Host *</label>
              <input
                className="Admin__Input"
                type="text"
                value={smtpHost}
                placeholder="smtp.gmail.com"
                onChange={(e) => setSmtpHost(e.target.value)}
              />
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">SMTP Port</label>
              <input
                className="Admin__Input"
                type="number"
                value={smtpPort}
                placeholder="587"
                onChange={(e) => setSmtpPort(e.target.value)}
              />
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">SMTP User *</label>
              <input
                className="Admin__Input"
                type="text"
                value={smtpUser}
                placeholder="your-email@example.com"
                onChange={(e) => setSmtpUser(e.target.value)}
              />
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">SMTP Password *</label>
              <input
                className="Admin__Input"
                type="password"
                value={smtpPassword}
                placeholder={smtpPasswordPlaceholder || 'Enter SMTP password'}
                onChange={(e) => setSmtpPassword(e.target.value)}
                onFocus={() => setSmtpPassword('')}
              />
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">Sender Email *</label>
              <input
                className="Admin__Input"
                type="email"
                value={senderEmail}
                placeholder="no-reply@example.com"
                onChange={(e) => setSenderEmail(e.target.value)}
              />
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">Sender Name</label>
              <input
                className="Admin__Input"
                type="text"
                value={senderName}
                placeholder="Weave"
                onChange={(e) => setSenderName(e.target.value)}
              />
            </div>

            <label className="Admin__CheckboxLabel">
              <input
                type="checkbox"
                checked={useTls}
                onChange={(e) => setUseTls(e.target.checked)}
              />
              Use TLS (STARTTLS)
            </label>

            <div className="Admin__BtnRow">
              <button
                className="Admin__SaveBtn"
                onClick={handleSaveSmtpConfig}
                disabled={smtpSaving}
              >
                {smtpSaving ? 'Saving...' : 'Save Configuration'}
              </button>
              <button
                className="Admin__TestBtn"
                onClick={handleTestSmtp}
                disabled={smtpTesting}
              >
                {smtpTesting ? 'Sending...' : 'Send Test Email'}
              </button>
            </div>
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
