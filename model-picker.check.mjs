import assert from 'node:assert/strict';
import vm from 'node:vm';
import { isModelPickerChunk, patchModelPicker } from './model-picker-patch.mjs';

const fixture = 'const label="dialog.model.recent";function $(e){return e.provider+":"+e.id}function group(e){let t=new Set(e.favorites.map($)),n=e.recent.filter(e=>!t.has($(e))),r=new Set([...t,...n.map($)]);return[...e.favorites.length>0?[{category:`favorite`,title:e.titles.favorite,items:e.favorites}]:[],...n.length>0?[{category:`recent`,title:e.titles.recent,items:n}]:[],...e.groups.flatMap(e=>{let t=e.items.filter(e=>!r.has($(e)));return t.length>0?[{...e,items:t}]:[]})]}function rows(C){return C().flatMap(e=>e.items.map(t=>({id:$(t),item:t,group:e})))}';
const patched = patchModelPicker(fixture);
assert.equal(isModelPickerChunk(fixture), true);
assert.equal(isModelPickerChunk(patched), true);
assert.equal(isModelPickerChunk('export default {"dialog.model.recent":"最近使用"}'), false, 'Translation chunks are not model picker code');
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
const memoFixture = fixture.slice(0, fixture.indexOf('function rows')) +
  'function picker(C,b,s,widget,dispatch){let list=b(e=>{let t=new Map(e.map(e=>[e.id,e]));return C().flatMap(e=>e.items.map(n=>{let r=t.get($(n));return r?.item===n&&r.section===e.category&&r.title===e.title?r:{id:$(n),item:n,section:e.category,title:e.title}}))},[]),favorite=e=>{widget?.setActive($(e)),dispatch({type:`keyboard`,id:$(e),repeat:!1})},selected=e=>{let i=()=>s(e.model.id),a=()=>e.attrs[`data-active`];return i()};return{list,favorite,selected}}';
const pick = vm.runInNewContext(patchModelPicker(memoFixture) + ';picker');
let active, dispatched;
const picker = pick(() => [{ category: 'recent', items: [a] }, { category: 'one', items: [a, b] }],
  (reduce, previous) => () => previous = reduce(previous), key => key === 'one:a',
  { active: () => ({ id: active }), setActive: id => { active = id; } }, event => { dispatched = event; });
const memoItems = picker.list();
assert.equal(new Set(memoItems.map(row => row.id)).size, 3);
assert.equal(picker.list()[1], memoItems[1], 'Keep native row memoization');
assert.ok(picker.selected({ model: memoItems[1], attrs: {} }), 'Selection compares the underlying model key');
active = memoItems[1].id;
picker.favorite(a);
assert.equal(active, memoItems[1].id, 'Keep keyboard focus on the same duplicate row');
assert.equal(dispatched.id, active);
console.log('Model picker checks passed');
