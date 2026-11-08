import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="card"
          style={{
            maxWidth: '520px',
            margin: '2rem auto',
            textAlign: 'center',
            padding: '2rem 1.5rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: '1rem',
              color: 'var(--amber)',
            }}
          >
            <AlertTriangle size={44} />
          </div>
          <h3 style={{ marginBottom: '0.5rem' }}>Something went wrong</h3>
          <p className="text-muted" style={{ fontSize: '0.88rem', marginBottom: '1.25rem' }}>
            An unexpected error occurred while rendering this view. You can reload or refresh the page.
          </p>
          {this.state.error && (
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: 'var(--danger)',
                padding: '0.65rem 0.85rem',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontFamily: 'monospace',
                textAlign: 'left',
                overflowX: 'auto',
                marginBottom: '1.25rem',
              }}
            >
              {this.state.error.message || String(this.state.error)}
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={this.handleReset}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            <RefreshCw size={15} /> Reload View
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

