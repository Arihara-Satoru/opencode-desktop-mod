import assert from 'node:assert/strict';
import vm from 'node:vm';
import { patchModelPicker } from './model-picker-patch.mjs';

const fixture = 'const label="dialog.model.recent";function $(e){return e.provider+":"+e.id}function group(e){let t=new Set(e.favorites.map($)),n=e.recent.filter(e=>!t.has($(e))),r=new Set([...t,...n.map($)]);return[...e.favorites.length>0?[{category:`favorite`,title:e.titles.favorite,items:e.favorites}]:[],...n.length>0?[{category:`recent`,title:e.titles.recent,items:n}]:[],...e.groups.flatMap(e=>{let t=e.items.filter(e=>!r.has($(e)));return t.length>0?[{...e,items:t}]:[]})]}function rows(C){return C().flatMap(e=>e.items.map(t=>({id:$(t),item:t,group:e})))}';
const patched = patchModelPicker(fixture);
assert.equal(patchModelPicker(patched), patched);
const api = vm.runInNewContext(patched + ';({group,rows})');
const a = { provider: 'one', id: 'a' }, b = { provider: 'one', id: 'b' }, c = { provider: 'two', id: 'a' };
for (const favorites of [[], [a]]) {
  for (const recent of [[], [a, b, c]]) {
    const groups = [{ category: 'one', items: [a, b] }, { category: 'two', items: [c] }, { category: 'empty', items: [] }];
    const output = api.group({ groups, favorites, recent, titles: { favorite: 'Favorites', recent: 'Recent' } });
    assert.equal(output.find(g => g.category === 'one'), groups[0]);
    assert.equal(output.find(g => g.category === 'two'), groups[1]);
    assert.ok(!output.some(g => g.category === 'empty'));
    const rows = api.rows(() => output);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    for (const row of rows) assert.ok([a, b, c].includes(row.item));
    assert.equal(output.find(g => g.category === 'recent')?.items.length ?? 0, recent.length - (favorites.length && recent.length ? 1 : 0));
  }
}
assert.throws(() => patchModelPicker('unknown'), /未写入补丁/);
assert.throws(() => patchModelPicker(fixture + fixture), /未写入补丁/);
console.log('Model picker checks passed');
