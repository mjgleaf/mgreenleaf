import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, info) {
        console.error('OSCAR Render Crash:', error, info?.componentStack);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '30px', background: 'rgba(255,50,50,0.1)', border: '1px solid #f85149', borderRadius: '10px', margin: '20px' }}>
                    <h3 style={{ color: '#f85149' }}>Component Crashed</h3>
                    <p style={{ color: '#ccc' }}>{this.state.error?.message || 'Unknown error'}</p>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        style={{ marginTop: '10px', padding: '8px 16px', background: 'var(--accent)', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}
                    >
                        Try Again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default ErrorBoundary;
