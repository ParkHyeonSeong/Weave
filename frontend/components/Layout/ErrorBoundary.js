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
        <div className="ErrorBoundary">
          <AlertTriangle className="ErrorBoundary__Icon" size={48} />
          <h2 className="ErrorBoundary__Title">
            문제가 발생했습니다
          </h2>
          <p className="ErrorBoundary__Message">
            예상치 못한 오류가 발생했습니다. 페이지를 새로고침해 주시거나, 문제가 계속되면 관리자에게 문의해 주세요.
          </p>
          <button
            className="ErrorBoundary__Button"
            onClick={() => window.location.reload()}
          >
            새로고침
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
