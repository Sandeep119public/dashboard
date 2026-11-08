import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../BTCUSD_Market_Mechanics_Lab_Fixed.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('workstation visual pass is present without replacing chart or data controls', () => {
  assert.match(html, /id="workstation-visual-redesign"/);
  assert.match(html, /id="chartStage"/);
  assert.match(html, /id="chartSelect"/);
  assert.match(html, /id="headerImport"/);
  assert.match(html, /id="headerFilters"/);
  assert.match(html, /id="filterDrawer"/);
  assert.match(html, /id="tradeFiles"/);
  assert.match(html, /function setActiveChart/);
  assert.match(html, /WORKSTATION_CHARTS/);
});

test('mobile workstation layout keeps the chart stage flexible and controls touch-sized', () => {
  assert.match(html, /\.chart-stage\{padding:3px;border-radius:10px\}/);
  assert.match(html, /\.chart-select\{min-height:42px/);
  assert.match(html, /\.header-actions \.btn\{min-height:42px/);
  assert.match(html, /grid-template-rows:auto auto auto auto minmax\(0,1fr\) auto/);
});

test('service worker cache version advances with the visual shell update', () => {
  assert.match(sw, /btc-mechanics-shell-v35/);
});


test('declutter pass removes repeated header and empty-state actions while preserving primary controls', () => {
  assert.ok(html.includes('id="workstation-declutter-pass"'));
  assert.ok(html.includes('.brand .eyebrow,'));
  assert.ok(html.includes('.empty-hint{display:none!important}'));
  assert.ok(html.includes('id="headerImport" type="button">Import</button>'));
  assert.ok(html.includes('id="headerFilters" type="button" aria-expanded="false" aria-controls="filterDrawer">Settings</button>'));
  assert.ok(html.includes('id="emptyImport"'));
  assert.ok(html.includes('id="filterDrawer"'));
});

