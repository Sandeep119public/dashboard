// File-level import orchestration. UI state is injected through callbacks, never read from the DOM.
import { zipCsvEntries, zipEntryStream } from '../ingestion/zip-reader.js';
import { parseCsvStreamByDay } from '../ingestion/csv-parser.js';

const isCancelled = shouldCancel => Boolean(shouldCancel && shouldCancel());

export async function readTradeFiles(files, {
  shouldCancel = () => false,
  onProgress = () => {},
  barSteps,
  histLabels
} = {}) {
  const selected = Array.from(files || []).filter(file => /\\.(csv|zip)$/i.test(file.name || ''));
  if (!selected.length) throw new Error('No .CSV or .ZIP trade files were found in that selection.');

  const incoming = new Map();
  const progress = (rows, date, name) => onProgress({ type: 'rows', rows, date, name });
  const acceptDays = days => {
    for (const [date, obj] of days) {
      if (incoming.has(date)) {
        throw new Error('More than one selected file contains ' + date + '. Select a monthly archive by itself, or avoid overlapping CSV/ZIP files in one batch.');
      }
      incoming.set(date, obj);
    }
  };

  for (const file of selected) {
    if (isCancelled(shouldCancel)) throw new Error('Import cancelled by user.');
    if (/\\.zip$/i.test(file.name)) {
      const entries = await zipCsvEntries(file);
      for (const entry of entries) {
        if (isCancelled(shouldCancel)) throw new Error('Import cancelled by user.');
        onProgress({ type: 'entry', fileName: file.name, entryName: entry.name, uncompressedBytes: entry.uncompSize });
        const stream = await zipEntryStream(file, entry);
        const days = await parseCsvStreamByDay(stream, entry.name, progress, shouldCancel, { barSteps, histLabels });
        acceptDays(days);
      }
    } else {
      onProgress({ type: 'csv', fileName: file.name });
      const days = await parseCsvStreamByDay(file.stream(), file.name, progress, shouldCancel, { barSteps, histLabels });
      acceptDays(days);
    }
  }
  if (isCancelled(shouldCancel)) throw new Error('Import cancelled by user.');
  return incoming;
}
