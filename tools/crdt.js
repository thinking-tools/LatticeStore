import { Model } from 'json-joy/lib/json-crdt/index.js';
import { s } from 'json-joy/lib/json-crdt-patch/index.js';
// import { PatchBuilder, LogicalClock } from 'json-joy/lib/json-crdt-patch';
const SESSION_SERVER = Model.sid();
const schema = s.obj({
  username: s.str('default_username'),
  files: s.arr([]),
});
const model = Model.create(schema, SESSION_SERVER);
const patch = model.api.flush();
console.log('model', model.view());
console.log(patch.toString().length);
const patch2 = model.api.flush();
console.log('patch2', patch2.toString().length);
const patch3 = model.api.flush();
console.log('patch3', patch3.toString());
let u = model.api.str(['username']);

console.log('model after change', u, model.view());
