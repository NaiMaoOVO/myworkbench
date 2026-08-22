import { useEffect, useState } from 'react';

const frequencyLabels: Record<string, string> = {
  manual: '手动扫描',
  launch: '启动后扫描一次',
  '15min': '活跃期每 15 分钟增量',
};

export function SettingsView({ refreshKey }: { refreshKey: number }) {
  const bridge = window.myWorkbench?.settings;
  const [scanFrequency, setScanFrequency] = useState('manual');
  const [dataDir, setDataDir] = useState('');
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (bridge) {
        const result = await bridge.get();
        if (cancelled) return;
        if (result.ok && result.value) {
          setScanFrequency(result.value.scanFrequency ?? 'manual');
          setDataDir(result.value.dataDir ?? '');
        }
      } else {
        try {
          const payload = await fetch('/api/settings').then((r) => r.json());
          if (cancelled) return;
          setScanFrequency(typeof payload.scanFrequency === 'string' ? payload.scanFrequency : 'manual');
        } catch { /* read-only fallback keeps defaults */ }
      }
      if (!cancelled) setState('ready');
    };
    void load();
    return () => { cancelled = true; };
  }, [bridge, refreshKey]);

  const save = async (value: string) => {
    setScanFrequency(value);
    if (!bridge) { setMessage('浏览器模式下设置只读，请在桌面外壳中修改。'); return; }
    const result = await bridge.set('scanFrequency', value);
    setMessage(result.ok ? '已保存。' : result.error ?? '保存失败。');
  };

  const exportReport = async () => {
    try {
      const endpoints = ['/api/dashboard', '/api/projects', '/api/quality', '/api/settings'] as const;
      const report: Record<string, unknown> = { exportedAt: new Date().toISOString(), language: 'zh-CN' };
      for (const endpoint of endpoints) {
        const key = endpoint.replace('/api/', '');
        report[key] = await fetch(endpoint).then((response) => response.json());
      }
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'myworkbench-report-' + new Date().toISOString().slice(0, 10) + '.json';
      link.click();
      URL.revokeObjectURL(url);
      setMessage('报告已导出（不含正文与路径）。');
    } catch {
      setMessage('报告导出失败。');
    }
  };

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify({ scanFrequency, language: 'zh-CN', telemetry: 'disabled', exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'myworkbench-config.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="view-panel settings-view" aria-labelledby="settings-view-title">
      <div className="view-heading"><div><p className="eyebrow">偏好</p><h2 id="settings-view-title">设置</h2></div><p className="muted">遥测始终关闭；所有数据仅保存在本机。</p></div>
      {state === 'loading' ? <p className="muted">正在加载设置…</p> : null}
      {state === 'ready' ? <>
        <div className="settings-row">
          <label htmlFor="setting-frequency">扫描频率</label>
          <select id="setting-frequency" value={scanFrequency} onChange={(event) => void save(event.target.value)}>
            {Object.entries(frequencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <p className="muted settings-note">保存后立即按新频率调度；同步为增量式，未变更的来源几乎零开销。</p>
        <div className="settings-row">
          <span>语言</span><span className="muted">中文（简体）</span>
        </div>
        <div className="settings-row">
          <span>遥测</span><span className="muted">始终关闭</span>
        </div>
        {dataDir ? <div className="settings-row"><span>数据目录</span><span className="muted settings-dir">{dataDir}</span></div> : null}
        <div className="settings-row">
          <span>工作报告导出</span>
          <button className="text-button" type="button" onClick={exportReport}>导出 JSON</button>
        </div>
        <div className="settings-row">
          <span>导出配置</span>
          <button className="text-button" type="button" onClick={exportConfig}>导出 JSON</button>
        </div>
        {message ? <p className="operation-message" role="status">{message}</p> : null}
      </> : null}
    </section>
  );
}
