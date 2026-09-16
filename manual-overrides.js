export function manualIdentity(item) {
  const generated = item.generatedTitle || item.title || '';
  const codes = [...generated.toUpperCase().matchAll(/\[(\s*[A-Z]{1,5}[- ]?\d{1,4}\s*)\]|【(\s*[A-Z]{1,5}[- ]?\d{1,4}\s*)】/g)]
    .map(match => (match[1] || match[2]).replace(/[-\s]/g, '')).sort();
  const official = (item.sources || []).find(source => source.type === 'official' && source.url)?.url;
  const name = generated.replace(/[\s“”「」『』]/g, '').toLowerCase();
  return [item.kind, item.brand, item.date, item.language || '', codes.length ? codes.join('+') : official || name].join('|');
}

export function manualRecord(item, data) {
  const records = data?.records || {};
  if (Object.hasOwn(records, item.id)) return { key: item.id, value: records[item.id] };
  const identity = manualIdentity(item);
  const matches = Object.entries(records).filter(([, record]) => record.identity === identity);
  return matches.length === 1 ? { key: matches[0][0], value: matches[0][1] } : { key: item.id, value: {} };
}

export function applyManualTitle(item, data) {
  const generatedTitle = item.generatedTitle || item.title;
  const customTitle = manualRecord(item, data).value.customTitle;
  return { ...item, generatedTitle, title: customTitle || generatedTitle, titleIsManual: Boolean(customTitle) };
}
