function SophubPage() {
  const openExternal = () => {
    const shell = (window as any).electronShell;
    if (shell) {
      shell.openExternal('https://fudankw.cn/sophub/');
    } else {
      window.open('https://fudankw.cn/sophub/', '_blank');
    }
  };

  return (
    <div className="sophub-page">
      <div className="sophub-toolbar">
        <span style={{ fontSize: '13px', color: 'var(--text-2)' }}>Sophub may require login — if iframe doesn't work, open in browser:</span>
        <button className="btn-primary btn-sm" onClick={openExternal}>Open in Browser</button>
      </div>
      <iframe
        src="https://fudankw.cn/sophub/"
        className="sophub-page-iframe"
        title="Sophub"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}

export default SophubPage;
