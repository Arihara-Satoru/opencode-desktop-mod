import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./panel-c7bWJg2T.js', import.meta.url), 'utf8');
const start = source.indexOf('    const items = [];', source.indexOf('  const rebuildTicks ='));
const end = source.indexOf('    cachedItems = items;', start);
assert.ok(start >= 0 && end > start, 'Locate the actual ruler item builder');
const build = vm.runInNewContext('(turns)=>{' + source.slice(start, end) + 'return items}');
const turns = Array.from({ length: 3 }, (_, i) => ({
  userMessageID: 'message-' + i,
  title: 'User prompt ' + i,
  preview: 'Reply summary',
  headings: Array.from({ length: 12 }, (_, j) => ({ level: j % 3 + 1, text: 'Section ' + j, partID: 'part-' + i, headingIdx: j })),
}));
assert.equal(build([]).length, 0);
const items = build(turns);
assert.equal(items.length, turns.length, 'Exactly one tick per user message regardless of reply headings');
items.forEach((item, i) => {
  assert.equal(item.type, 'turn');
  assert.equal(item.id, turns[i].userMessageID);
  assert.equal(item.heading, null, 'Ruler clicks target the user message');
  assert.equal(item.turn, turns[i], 'Preserve the full turn for the hover card');
  assert.equal(item.turn.headings.length, 12);
});
const card = source.slice(source.indexOf('  const showHoverCardForIndex ='), source.indexOf('  // Build tick marks'));
assert.ok(card.includes('for (const h of turn.headings)'), 'Keep the detailed hover heading list');
assert.ok(card.includes('jumpToTurnOrHeading(mountedPanel, turn.userMessageID, h,'), 'Keep heading navigation inside the card');
console.log('Timeline checks passed: one tick per user message, detailed hover headings preserved.');
