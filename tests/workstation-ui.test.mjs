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
  assert.match(sw, /btc-mechanics-shell-v36/);
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



test('settings drawer keeps quick ranges visible and collapses secondary tools and chart appearance', () => {
  assert.match(html, /class="toolbar-block drawer-quick-range"/);
  assert.match(html, /<details class="drawer-tools-details">/);
  assert.match(html, /<details class="drawer-settings-details">/);
  assert.match(html, /id="importFolder"/);
  assert.match(html, /id="exportBars"/);
  assert.match(html, /id="exportEvents"/);
  assert.match(html, /id="saveWorkspace"/);
  assert.match(html, /id="loadWorkspace"/);
  assert.match(html, /id="chartStudio"/);
  assert.match(html, /id="panelVisibility"/);
});


test('settings drawer keeps advanced filters collapsed and preserves their control IDs', () => {
  assert.ok(html.includes('<details class="advanced-filter-details">'));
  assert.ok(html.includes('<summary>Advanced filters</summary>'));
  for (const id of ['start', 'end', 'threshold', 'profileBin', 'smooth', 'flowLookback']) {
    assert.ok(html.includes('id="' + id + '"'));
  }
  assert.ok(html.includes('.filter-drawer .import-control{position:absolute!important'));
  assert.ok(html.includes('id="headerImport" type="button">Import</button>'));
});

test('settings drawer hides repeated section captions without removing layout actions', () => {
  assert.ok(html.includes('.drawer-tools-details .toolbar-label{display:none}'));
  assert.ok(html.includes('.studio-topline>div:first-child{display:none}'));
  assert.ok(html.includes('id="saveViewPreset"'));
  assert.ok(html.includes('id="resetStudio"'));
});
