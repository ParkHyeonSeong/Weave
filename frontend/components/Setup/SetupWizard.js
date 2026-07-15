import { useState } from 'react';
import { useRouter } from 'next/router';
import {
  Building2, Users, Shield, Mail, Lock, User,
  Eye, EyeOff, Loader2, ArrowRight, ArrowLeft, Check
} from 'lucide-react';
import { axios } from '@/library/_axios';
import Alert from '@/components/modal/Alert';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

const TOTAL_STEPS = 3;

export default function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: 워크스페이스
  const [workspaceName, setWorkspaceName] = useState('');

  // Step 2: 등록 정책
  const [registrationPolicy, setRegistrationPolicy] = useState('private');

  // Step 3: 관리자 계정
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Alert
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const showAlert = (title, message) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertOpen(true);
  };

  const handleNext = () => {
    if (step === 1 && !workspaceName.trim()) {
      showAlert('Input Error', 'Please enter a workspace name.');
      return;
    }
    setStep(step + 1);
  };

  const handleBack = () => {
    setStep(step - 1);
  };

  const handleSubmit = async () => {
    if (!username.trim()) {
      showAlert('Input Error', 'Please enter your name.');
      return;
    }
    if (!email.trim()) {
      showAlert('Input Error', 'Please enter your email.');
      return;
    }
    if (password.length < 8) {
      showAlert('Input Error', 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      showAlert('Input Error', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post('/setup/initialize', {
        workspace_name: workspaceName,
        registration_policy: registrationPolicy,
        email,
        password,
        username,
      });

      if (res.data.status) {
        sessionStorage.setItem('profile', JSON.stringify(res.data.profile));
        sessionStorage.setItem('app_initialized', 'true');
        router.push('/');
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? 'An unexpected error occurred. Please try again.';
        showAlert('Error', msg);
      }
    } catch (error) {
      showAlert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const stepLabel = (s) => {
    if (s === 1) return 'Workspace';
    if (s === 2) return 'Policy';
    return 'Admin';
  };

  const stepClass = (s) => {
    let cls = 'Setup__Step';
    if (s === step) cls += ' Setup__Step--active';
    if (s < step) cls += ' Setup__Step--done';
    return cls;
  };

  return (
    <div className="Setup">
      <div className="Setup__Card">
        <div className="Setup__Header">
          <h1 className="Setup__Logo">Weave</h1>
          <p className="Setup__Subtitle">Initial Setup</p>
        </div>

        {/* 스텝 인디케이터 */}
        <div className="Setup__Steps">
          {[1, 2, 3].map((s) => (
            <div key={s} className={stepClass(s)}>
              <div className="Setup__StepCircle">
                {s < step ? <Check size={14} /> : s}
              </div>
              <span className="Setup__StepLabel">{stepLabel(s)}</span>
            </div>
          ))}
        </div>

        <form onSubmit={(e) => {
          e.preventDefault();
          if (step < TOTAL_STEPS) handleNext();
          else handleSubmit();
        }}>
          {/* Step 1: 워크스페이스 이름 */}
          {step === 1 && (
            <div className="Setup__Content">
              <div className="Setup__ContentHeader">
                <Building2 size={20} className="Setup__ContentIcon" />
                <h2 className="Setup__ContentTitle">Workspace Name</h2>
              </div>
              <p className="Setup__ContentDesc">
                Enter your team or company name. This will be displayed throughout the app.
              </p>
              <div className="Setup__Field">
                <div className="Setup__InputWrap">
                  <Building2 size={16} className="Setup__InputIcon" />
                  <input
                    type="text"
                    className="Setup__Input"
                    placeholder="e.g., Acme Corp"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: 등록 정책 */}
          {step === 2 && (
            <div className="Setup__Content">
              <div className="Setup__ContentHeader">
                <Users size={20} className="Setup__ContentIcon" />
                <h2 className="Setup__ContentTitle">Registration Policy</h2>
              </div>
              <p className="Setup__ContentDesc">
                Choose who can create an account on this workspace.
              </p>
              <div className="Setup__PolicyCards">
                <button
                  type="button"
                  className={`Setup__PolicyCard ${registrationPolicy === 'public' ? 'Setup__PolicyCard--active' : ''}`}
                  onClick={() => setRegistrationPolicy('public')}
                >
                  <Users size={24} className="Setup__PolicyIcon" />
                  <strong className="Setup__PolicyTitle">Public</strong>
                  <p className="Setup__PolicyDesc">Anyone can sign up freely.</p>
                </button>
                <button
                  type="button"
                  className={`Setup__PolicyCard ${registrationPolicy === 'private' ? 'Setup__PolicyCard--active' : ''}`}
                  onClick={() => setRegistrationPolicy('private')}
                >
                  <Shield size={24} className="Setup__PolicyIcon" />
                  <strong className="Setup__PolicyTitle">Private</strong>
                  <p className="Setup__PolicyDesc">Admin must approve new members.</p>
                </button>
              </div>
            </div>
          )}

          {/* Step 3: 관리자 계정 */}
          {step === 3 && (
            <div className="Setup__Content">
              <div className="Setup__ContentHeader">
                <Shield size={20} className="Setup__ContentIcon" />
                <h2 className="Setup__ContentTitle">Admin Account</h2>
              </div>
              <p className="Setup__ContentDesc">
                Create the first administrator account for this workspace.
              </p>
              <div className="Setup__Form">
                <div className="Setup__Field">
                  <label className="Setup__Label" htmlFor="setup-username">Name</label>
                  <div className="Setup__InputWrap">
                    <User size={16} className="Setup__InputIcon" />
                    <input
                      id="setup-username"
                      type="text"
                      className="Setup__Input"
                      placeholder="Your name"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="name"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="Setup__Field">
                  <label className="Setup__Label" htmlFor="setup-email">Email</label>
                  <div className="Setup__InputWrap">
                    <Mail size={16} className="Setup__InputIcon" />
                    <input
                      id="setup-email"
                      type="email"
                      className="Setup__Input"
                      placeholder="admin@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="Setup__Field">
                  <label className="Setup__Label" htmlFor="setup-password">Password</label>
                  <div className="Setup__InputWrap">
                    <Lock size={16} className="Setup__InputIcon" />
                    <input
                      id="setup-password"
                      type={showPassword ? 'text' : 'password'}
                      className="Setup__Input"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="Setup__TogglePassword"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="Setup__Field">
                  <label className="Setup__Label" htmlFor="setup-confirm">Confirm Password</label>
                  <div className="Setup__InputWrap">
                    <Lock size={16} className="Setup__InputIcon" />
                    <input
                      id="setup-confirm"
                      type={showPassword ? 'text' : 'password'}
                      className="Setup__Input"
                      placeholder="Confirm password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 하단 버튼 */}
          <div className="Setup__Actions">
            {step > 1 && (
              <button type="button" className="Setup__BackBtn" onClick={handleBack}>
                <ArrowLeft size={16} /> Back
              </button>
            )}
            <div className="Setup__ActionsSpacer" />
            {step < TOTAL_STEPS ? (
              <button type="submit" className="Setup__NextBtn">
                Next <ArrowRight size={16} />
              </button>
            ) : (
              <button type="submit" className="Setup__SubmitBtn" disabled={loading}>
                {loading ? <Loader2 size={18} className="Setup__Spinner" /> : 'Complete Setup'}
              </button>
            )}
          </div>
        </form>
      </div>

      <Alert
        isOpen={alertOpen}
        title={alertTitle}
        contents={alertMessage}
        onClose={() => setAlertOpen(false)}
      />
    </div>
  );
}
