import { useEffect, useState } from 'react';

type Candidate = { sourceId: string; path: string; exists: boolean };

type ScanStatus = 'pending' | 'running' | 'success' | 'partial' | 'blocked' | 'cancelled';

const sourceNames: Record<string, string> = {
  claude: 'Claude', codex: 'Codex', gemini: 'Gemini', iflow: 'iFlow',
  zcode: 'ZCode', 'kimi-code': 'Kimi Code', hermes: 'Hermes', openclaw: 'OpenClaw',
};

export function FirstRunWizard({ onComplete }: { onComplete: () => void }) {
  const bridge = window.myWorkbench;
  const [step, setStep] = useState<'privacy' | 'discover' | 'scanning' | 'done'>('privacy');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Record<string, ScanStatus>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 'discover') return;
    let cancelled = false;
    void (async () => {
      if (!bridge?.sources) return;
      const result = await bridge.sources.discoverCandidates();
      if (cancelled) return;
      if (!result.ok || !result.value) { setLoadError(result.error ?? '候选目录发现失败。'); return; }
      // 每个工具只保留第一个真实存在的候选目录，未存在的标记出来供用户手动定位。
      const seen = new Set<string>();
      const rows = result.value.filter((row) => {
        if (!row.exists || seen.has(row.sourceId)) return false;
        seen.add(row.sourceId);
        return true;
      });
      setCandidates(rows);
    })();
    return () => { cancelled = true; };
  }, [step, bridge]);

  const finishWizard = () => {
    void bridge?.settings.set('wizardCompleted', 'true');
    onComplete();
  };

  const authorizeAndScan = async () => {
    if (!bridge?.sources) return;
    setStep('scanning');
    const initial: Record<string, ScanStatus> = {};
    for (const sourceId of selected) initial[sourceId] = 'pending';
    setOutcomes(initial);
    for (const sourceId of [...selected].sort()) {
      setOutcomes((current) => ({ ...current, [sourceId]: 'running' }));
      try {
        await bridge.sources.grantDirectory(sourceId, candidatePath(candidates, sourceId), 'metadata');
        const scanResult = await bridge.sources.scan(sourceId);
        const raw = (scanResult.value ?? {}) as { status?: string };
        setOutcomes((current) => ({ ...current, [sourceId]: normalizeStatus(raw.status) }));
      } catch {
        setOutcomes((current) => ({ ...current, [sourceId]: 'blocked' }));
      }
    }
    setStep('done');
  };

  const selectedList: string[] = [...selected];

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
      <section className="wizard-panel" aria-describedby="wizard-desc">
        {step === 'privacy' ? <>
          <p className="eyebrow">欢迎使用</p>
          <h1 id="wizard-title">MyWorkbench 工作台</h1>
          <p id="wizard-desc" className="wizard-lede">本地优先的个人工作证据驾驶舱。</p>
          <ul className="wizard-promises">
            <li>🔒 未明确授权前，不读取任何文件夹与会话正文</li>
            <li>📖 原始来源严格只读——Obsidian、Git 历史与 Agent 记录不会被修改</li>
            <li>🏠 所有派生索引仅保存在本机；GitHub 只用于分发源码与安装包</li>
            <li>↩️ 授权可随时撤销，派生索引可安全删除并重建</li>
          </ul>
          <div className="wizard-actions">
            <button className="text-button text-button--primary" type="button" onClick={() => setStep('discover')}>开始配置数据来源</button>
            <button className="text-button" type="button" onClick={finishWizard}>跳过，稍后在来源中心配置</button>
          </div>
        </> : null}

        {step === 'discover' ? <>
          <p className="eyebrow">第二步 · 自动发现</p>
          <h1 id="wizard-title">发现的数据源</h1>
          <p id="wizard-desc" className="muted">以下为本机检测到的候选目录（仅检查存在性，未读取任何内容）。勾选后将以「仅元数据」权限授权并执行首次扫描；正文权限之后可在来源中心逐源开启。</p>
          {loadError ? <p className="error-copy">{loadError}</p> : null}
          {!loadError && candidates.length === 0 ? <p className="muted">未在本机发现已安装工具的候选目录。可跳过向导，稍后在来源中心手动定位文件夹。</p> : null}
          {candidates.length > 0 ? (
            <ul className="wizard-candidates">
              {candidates.map((candidate) => (
                <li key={candidate.path}>
                  <label className="wizard-candidate">
                    <input
                      type="checkbox"
                      checked={selected.has(candidate.sourceId)}
                      onChange={(event) => setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(candidate.sourceId); else next.delete(candidate.sourceId);
                        return next;
                      })}
                    />
                    <span><strong>{sourceNames[candidate.sourceId] ?? candidate.sourceId}</strong><small>{candidate.path}</small></span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="wizard-actions">
            <button className="text-button text-button--primary" type="button" disabled={selected.size === 0} onClick={() => void authorizeAndScan()}>
              授权并扫描所选（{selected.size}）
            </button>
            <button className="text-button" type="button" onClick={finishWizard}>跳过</button>
          </div>
        </> : null}

        {step === 'scanning' || step === 'done' ? <>
          <p className="eyebrow">{step === 'done' ? '完成' : '第三步 · 首次扫描'}</p>
          <h1 id="wizard-title">{step === 'done' ? '扫描结果' : '正在读取所选来源…'}</h1>
          <ul className="wizard-outcomes">
            {selectedList.map((sourceId) => {
              const status = outcomes[sourceId] ?? 'pending';
              const labelMap: Record<string, string> = { pending: '等待中', running: '扫描中…', success: '成功', partial: '部分成功', blocked: '受阻', cancelled: '已取消' };
              return <li key={sourceId}><strong>{sourceNames[sourceId] ?? sourceId}</strong><span className={`scan-status scan-status--${status}`}>{labelMap[status] ?? status}</span></li>;
            })}
          </ul>
          {step === 'done' ? (
            <div className="wizard-actions">
              <button className="text-button text-button--primary" type="button" onClick={finishWizard}>进入工作台</button>
              <p className="muted">部分成功表示个别记录未能解析，详情见质量视图；正文权限可随时在来源中心开启。</p>
            </div>
          ) : null}
        </> : null}
      </section>
    </div>
  );
}

function candidatePath(candidates: Candidate[], sourceId: string): string {
  return candidates.find((candidate) => candidate.sourceId === sourceId)?.path ?? '';
}

function normalizeStatus(status: string | undefined): ScanStatus {
  if (status === 'success' || status === 'partial' || status === 'blocked' || status === 'cancelled') return status;
  return 'blocked';
}
