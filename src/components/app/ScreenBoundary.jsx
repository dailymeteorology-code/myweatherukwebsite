/* A screen that fails stays that screen's problem (17 Nov 2026): App.jsx puts one of these round each tab and each
   page opened from More, so an error while drawing one shows a note there with a way to try again, and the tab
   bar and the other tabs carry on. Without it, React took the whole app down to a blank page. */
import React from 'react';

export default class ScreenBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[screen] this screen failed to draw:', error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    /* a page opened afresh starts clean */
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{
        minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
        padding: '40px 24px', textAlign: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif',
      }}>
        <b style={{ fontSize: 20, letterSpacing: '-0.02em' }}>This screen hit a problem</b>
        <span style={{ maxWidth: 320, fontSize: 15, lineHeight: 1.45, opacity: 0.7 }}>The rest of the app still works. Try this screen again, or use the tabs below.</span>
        <button type="button" onClick={() => this.setState({ error: null })} style={{
          marginTop: 6, padding: '10px 20px', borderRadius: 14, border: 0, cursor: 'pointer',
          font: 'inherit', fontSize: 15, fontWeight: 650, color: '#fff', background: '#0a84ff',
        }}>Try again</button>
      </div>
    );
  }
}
