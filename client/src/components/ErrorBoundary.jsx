import { Component } from 'react';

// Top-level safety net (added 2026-08-18 after tracking down a real crash-to-blank-screen bug
// in ClientSettings.jsx): without this, any uncaught render/effect error anywhere in the app
// unmounts the entire React tree, leaving a totally blank page with no indication anything went
// wrong - the only way back in was a hard refresh. This catches that instead and shows a plain
// "something went wrong" message with a reload button, so a future bug of the same shape fails
// visibly and recoverably rather than silently.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Uncaught error caught by ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif' }}>
          <h2>Something went wrong on this page.</h2>
          <p style={{ color: '#62676f' }}>Nothing you were working on was lost - please reload to continue.</p>
          <button onClick={() => window.location.reload()}>Reload Page</button>
        </div>
      );
    }
    return this.props.children;
  }
}
