import { useState } from 'react';
import { useRouter } from 'next/router';
import { jwtDecode } from 'jwt-decode';
import { Mail, Lock, User, Eye, EyeOff, Loader2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import Alert from '@/components/modal/Alert';


export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [loading, setLoading] = useState(false);

  // 폼 상태
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Alert 상태
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const showAlert = (title, message) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    // 회원가입 검증
    if (mode === 'register') {
      if (!username.trim()) {
        showAlert('Input Error', 'Please enter your name.');
        return;
      }
      if (password !== confirmPassword) {
        showAlert('Input Error', 'Passwords do not match.');
        return;
      }
      if (password.length < 6) {
        showAlert('Input Error', 'Password must be at least 6 characters.');
        return;
      }
    }

    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const payload = mode === 'login'
        ? { email, password }
        : { email, password, username };

      const response = await axios.post(endpoint, payload);

      if (response.data.status) {
        const token = response.data.x_token;
        sessionStorage.setItem('x_token', token);
        sessionStorage.setItem('profile', JSON.stringify(jwtDecode(token)));
        router.push('/');
      } else {
        const messages = {
          'INVALID_CREDENTIALS': 'Invalid email or password.',
          'EMAIL_ALREADY_EXISTS': 'This email is already registered.',
          'REGISTRATION_DISABLED': 'Registration is not available. Contact your administrator.',
          'NOT_INITIALIZED': 'System setup is required first.',
        };
        showAlert('Error', messages[response.data.message] || response.data.message);
      }
    } catch (error) {
      showAlert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setConfirmPassword('');
    setUsername('');
  };

  return (
    <div className="Login">
      <div className="Login__Card">
        <div className="Login__Header">
          <h1 className="Login__Logo">Weave</h1>
          <p className="Login__Subtitle">
            {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
          </p>
        </div>

        <form className="Login__Form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="Login__Field">
              <label className="Login__Label" htmlFor="username">Name</label>
              <div className="Login__InputWrap">
                <User size={16} className="Login__InputIcon" />
                <input
                  id="username"
                  type="text"
                  className="Login__Input"
                  placeholder="Your name"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="name"
                />
              </div>
            </div>
          )}

          <div className="Login__Field">
            <label className="Login__Label" htmlFor="email">Email</label>
            <div className="Login__InputWrap">
              <Mail size={16} className="Login__InputIcon" />
              <input
                id="email"
                type="email"
                className="Login__Input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
          </div>

          <div className="Login__Field">
            <label className="Login__Label" htmlFor="password">Password</label>
            <div className="Login__InputWrap">
              <Lock size={16} className="Login__InputIcon" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="Login__Input"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
              <button
                type="button"
                className="Login__TogglePassword"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {mode === 'register' && (
            <div className="Login__Field">
              <label className="Login__Label" htmlFor="confirmPassword">Confirm Password</label>
              <div className="Login__InputWrap">
                <Lock size={16} className="Login__InputIcon" />
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  className="Login__Input"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>
          )}

          <button type="submit" className="Login__SubmitBtn" disabled={loading}>
            {loading
              ? <Loader2 size={18} className="Login__Spinner" />
              : mode === 'login' ? 'Sign In' : 'Create Account'
            }
          </button>
        </form>

        <div className="Login__Footer">
          <span className="Login__FooterText">
            {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
          </span>
          <button className="Login__FooterLink" onClick={toggleMode}>
            {mode === 'login' ? 'Sign Up' : 'Sign In'}
          </button>
        </div>
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
