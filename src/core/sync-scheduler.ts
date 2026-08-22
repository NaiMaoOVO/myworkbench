import type { ScanSummary } from './types.js';
import type { WorkbenchSourceService } from './source-service.js';

export type ScanFrequency = 'manual' | 'launch' | '15min';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * 多来源自动同步调度：
 * - manual：不自动扫描，仅在来源中心手动触发
 * - launch：桌面外壳启动后在后台做一次全量增量同步
 * - 15min ：启动同步之后，活跃期间每 15 分钟增量轮询
 *
 * 增量扫描本身幂等（未变更文件直接跳过），因此轮询开销接近于零。
 */
export class SyncScheduler {
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;
  #lastSyncAt: string | null = null;
  #lastError: string | null = null;

  constructor(
    private readonly service: WorkbenchSourceService,
    private readonly readFrequency: () => string,
    private readonly onLastSyncChange?: (iso: string) => void,
  ) {}

  /** 桌面外壳启动时调用：按当前频率决定是否执行启动同步与轮询。 */
  start(): void {
    const frequency = this.readFrequency();
    if (frequency !== 'manual') void this.runNow();
    this.#applyTimer(frequency);
  }

  /** 设置中的频率变化后调用；立即按新频率重排定时器（不额外触发扫描）。 */
  reschedule(): void {
    this.stopTimer();
    this.#applyTimer(this.readFrequency());
  }

  stop(): void {
    this.stopTimer();
  }

  #applyTimer(frequency: string): void {
    if (frequency === '15min') {
      this.#timer = setInterval(() => void this.runNow(), FIFTEEN_MINUTES_MS);
    }
  }

  stopTimer(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  status(): { running: boolean; lastSyncAt: string | null; lastError: string | null } {
    return { running: this.#running, lastSyncAt: this.#lastSyncAt, lastError: this.#lastError };
  }

  /** 立即对全部「就绪 / 部分成功」来源执行一轮增量同步。 */
  async runNow(): Promise<ScanSummary[]> {
    if (this.#running) return [];
    this.#running = true;
    const summaries: ScanSummary[] = [];
    try {
      const targets = this.service
        .list()
        .filter((source) => source.state === 'ready' || source.state === 'partial');
      for (const source of targets) {
        try {
          summaries.push(await this.service.scan(source.id));
        } catch (error) {
          this.#lastError = error instanceof Error ? error.message : '同步失败。';
        }
      }
      this.#lastSyncAt = new Date().toISOString();
      this.service.touchLastSync(this.#lastSyncAt);
      this.onLastSyncChange?.(this.#lastSyncAt);
      this.#lastError = null;
    } finally {
      this.#running = false;
    }
    return summaries;
  }
}
