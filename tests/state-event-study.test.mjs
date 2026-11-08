import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStateEvents } from '../src/research/state-event-study.js';

function fixture() {
  const t = Array.from({ length: 12 }, (_, i) => i * 3600);
  const c = [100, 100, 101, 102, 103, 100, 99, 98, 97, 100, 101, 102];
  const bars = {
    t,
    o: c.map(value => value),
    h: c.map(value => value + 2),
    l: c.map(value => value - 2),
    c,
    v: t.map(() => 10)
  };
  const states = {
    labels: ['Warm-up', 'Compression', 'Wide rotation'],
    values: [0, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 0].map(code => ({ code }))
  };
  return { bars, states };
}

test('detects only state-run starts and returns per-state event summaries', () => {
  const { bars, states } = fixture();
  const result = analyzeStateEvents(bars, states, { horizons: [1] });
  assert.equal(result.detectedEvents, 5);
  assert.equal(result.nonOverlapping, true);
  assert.equal(result.states.find(state => state.code === 1).horizons[0].sides[0].samples, 3);
  assert.equal(result.states.find(state => state.code === 2).horizons[0].sides[0].samples, 2);
});

test('enforces disjoint future windows independently at each horizon', () => {
  const { bars, states } = fixture();
  const result = analyzeStateEvents(bars, states, { horizons: [2] });
  assert.deepEqual(result.selectedEventsByHorizon, { 2: 3 });
  const samples = result.states.flatMap(state => state.horizons[0].sides.map(side => side.samples));
  assert.equal(samples[0] + samples[2], 3);
});

test('calculates long and short excursions and deducts round-trip costs', () => {
  const bars = {
    t: [0, 3600, 7200], o: [100, 100, 100], h: [100, 100, 110], l: [100, 100, 90], c: [100, 100, 105]
  };
  const states = { labels: ['Warm-up', 'Compression'], values: [{ code: 0 }, { code: 1 }, { code: 1 }] };
  const result = analyzeStateEvents(bars, states, { horizons: [1], costBps: 100 });
  const sides = result.states.find(state => state.code === 1).horizons[0].sides;
  const long = sides.find(side => side.side === 'long');
  const short = sides.find(side => side.side === 'short');
  assert.equal(long.samples, 1);
  assert.ok(Math.abs(long.medianGrossReturnPct - 5) < 1e-9);
  assert.ok(Math.abs(long.medianNetReturnPct - 4) < 1e-9);
  assert.ok(Math.abs(long.medianMfePct - 10) < 1e-9);
  assert.ok(Math.abs(long.medianMaePct - 10) < 1e-9);
  assert.ok(Math.abs(short.medianGrossReturnPct + 5) < 1e-9);
  assert.ok(Math.abs(short.medianNetReturnPct + 6) < 1e-9);
  assert.ok(Math.abs(short.medianMfePct - 10) < 1e-9);
  assert.ok(Math.abs(short.medianMaePct - 10) < 1e-9);
});

test('a missing-hour gap starts a new state event and invalidates crossing windows', () => {
  const { bars, states } = fixture();
  bars.t[4] += 3600;
  for (let i = 5; i < bars.t.length; i++) bars.t[i] += 3600;
  const result = analyzeStateEvents(bars, states, { horizons: [1] });
  assert.equal(result.detectedEvents, 6);
});

test('applies the selected event-start window and side filter', () => {
  const { bars, states } = fixture();
  const result = analyzeStateEvents(bars, states, {
    horizons: [1], side: 'short', startTime: 3600, endTime: 18000
  });
  assert.equal(result.side, 'short');
  assert.equal(result.detectedEvents, 3);
  assert.ok(result.states.every(state => state.horizons[0].sides.length === 1));
});

test('rejects malformed bars, duplicate horizons, invalid sides and negative costs', () => {
  const { bars, states } = fixture();
  assert.throws(() => analyzeStateEvents({ ...bars, c: [] }, states), /equal-length/);
  assert.throws(() => analyzeStateEvents(bars, states, { horizons: [1, 1] }), /unique/);
  assert.throws(() => analyzeStateEvents(bars, states, { side: 'flat' }), /side/);
  assert.throws(() => analyzeStateEvents(bars, states, { costBps: -1 }), /costBps/);
});
