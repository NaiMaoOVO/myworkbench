import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalApiServer } from './server.js';

const api = new LocalApiServer({
  databasePath: join(tmpdir(), 'myworkbench-dev.sqlite'),
  appOrigin: 'http://127.0.0.1:5173',
});

const port = await api.start(Number(process.env.MYWORKBENCH_PORT ?? 8788));
console.log(`MyWorkbench local API is listening on http://127.0.0.1:${port}`);
console.log('Development control credentials are intentionally not printed.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void api.stop().finally(() => process.exit(0)));
}
