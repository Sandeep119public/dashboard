import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../BTCUSD_Market_Mechanics_Lab_Fixed.html', import.meta.url), 'utf8');
const start = html.indexOf('async function zipCsvEntries(file){');
const end = html.indexOf('async function zipEntryStream(file,entry){', start);
assert.ok(start >= 0 && end > start, 'ZIP directory parser must remain available for regression tests');
const zipCsvEntries = new Function(`${html.slice(start, end)}; return zipCsvEntries;`)();

function makeZip({ name = 'trades.csv', data = 'timestamp,price,size,buyer_role,product_symbol\\n2026-08-01 00:00:00,60000,1,taker,BTCUSD\\n' } = {}) {
  const filename = Buffer.from(name);
  const payload = Buffer.from(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const localRecord = Buffer.concat([local, filename, payload]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE(0, 42);
  const centralRecord = Buffer.concat([central, filename]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRecord.length, 12);
  eocd.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, eocd]);
}

function asFile(bytes, name = 'sample.zip') {
  const blob = new Blob([bytes]);
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}

test('accepts a standard ZIP containing one CSV entry', async () => {
  const entries = await zipCsvEntries(asFile(makeZip()));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'trades.csv');
  assert.equal(entries[0].method, 0);
  assert.ok(entries[0].uncompSize > 0);
});

test('rejects a ZIP with no CSV entries', async () => {
  await assert.rejects(zipCsvEntries(asFile(makeZip({ name: 'readme.txt' }))), /No \.csv file found/);
});

test('rejects a central directory whose declared size is too short', async () => {
  const bytes = makeZip();
  const eocdOffset = bytes.length - 22;
  bytes.writeUInt32LE(1, eocdOffset + 12);
  await assert.rejects(zipCsvEntries(asFile(bytes)), /exceeds the declared directory size|overlaps its end record/);
});

test('rejects ZIP64 sentinel values with a useful error', async () => {
  const bytes = makeZip();
  const eocdOffset = bytes.length - 22;
  bytes.writeUInt16LE(0xffff, eocdOffset + 8);
  bytes.writeUInt16LE(0xffff, eocdOffset + 10);
  await assert.rejects(zipCsvEntries(asFile(bytes)), /ZIP64 archives are not supported/);
});

test('rejects an archive with a missing end-of-central-directory record', async () => {
  const bytes = makeZip().subarray(0, -22);
  await assert.rejects(zipCsvEntries(asFile(bytes)), /Could not read ZIP directory/);
});
