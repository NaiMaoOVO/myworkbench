import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Keeps a rendering crash from blanking the whole cockpit; local data is untouched. */
export class CockpitErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('MyWorkbench 界面发生未处理异常。', error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="cockpit-shell">
          <section className="state-panel" aria-labelledby="crash-title">
            <div className="state-indicator" aria-hidden="true" />
            <div>
              <h2 id="crash-title">界面遇到问题</h2>
              <p>工作台遇到了未处理的异常。本地数据与来源文件不受影响，重新加载即可恢复。</p>
              <button className="text-button" type="button" onClick={() => window.location.reload()}>重新加载</button>
            </div>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
