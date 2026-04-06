import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: '16px',
          color: '#6B7280',
          fontFamily: 'inherit',
        }}>
          <AlertTriangle size={48} color="#D97706" />
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#1C1C1C' }}>
            문제가 발생했습니다
          </h2>
          <p style={{ fontSize: '14px' }}>
            예상치 못한 오류가 발생했습니다. 페이지를 새로고침해 주시거나, 문제가 계속되면 관리자에게 문의해 주세요.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              background: '#5E6AD2',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              border: 'none',
            }}
          >
            새로고침
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
