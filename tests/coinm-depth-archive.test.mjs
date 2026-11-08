import test from 'node:test';
import assert from 'node:assert/strict';
import { createDepthArchiveStore } from '../src/market/coinm-depth-archive.js';

test('depth archive memory fallback persists samples, deduplicates and orders them', async () => {
  const archive = createDepthArchiveStore({ indexedDBImpl: null, maxSamples: 3 });
  const sample = (time, id) => ({ time, lastUpdateId: id, segment: 0, bids: [{ price: 100, qty: 2 }], asks: [{ price: 101, qty: 3 }] });
  await archive.append([sample(3000, 3), sample(1000, 1), sample(2000, 2)]);
  await archive.append([sample(2000, 2), sample(4000, 4)]);
  const rows = await archive.load();
  assert.deepEqual(rows.map(row => row.time), [2000, 3000, 4000]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].bids[0].qty, 2);
  await archive.clear({ symbol: 'BTCUSD_PERP' });
  assert.equal((await archive.load()).length, 0);
});

test('depth archive isolates symbols', async () => {
  const archive = createDepthArchiveStore({ indexedDBImpl: null });
  const sample = { time: 1000, lastUpdateId: 1, bids: [], asks: [] };
  await archive.append([sample], 'BTCUSD_PERP');
  await archive.append([sample], 'ETHUSD_PERP');
  assert.equal((await archive.load({ symbol: 'BTCUSD_PERP' })).length, 1);
  assert.equal((await archive.load({ symbol: 'ETHUSD_PERP' })).length, 1);
});
