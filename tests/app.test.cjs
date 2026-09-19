const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function app(seed = {}) {
  const values = new Map(Object.entries(seed));
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {value:'', hidden:false, style:{}, dataset:{}, innerHTML:'', textContent:'', listeners:{}, children:[], classList:{add(){},remove(){},toggle(){}}, replaceChildren(){this.children=[];this.value='';this.innerHTML='';}, appendChild(el){this.children.push(el);if(this.children.length===1)this.value=el.value;}, addEventListener(type, fn){this.listeners[type]=fn;}, focus(){}, click(){}, remove(){}});
    return elements.get(id);
  };
  let failWrites = false;
  const context = vm.createContext({console,crypto:webcrypto,confirm:()=>true,setTimeout:()=>0,clearTimeout(){}, document:{getElementById:element,createElement:()=>({}),querySelectorAll:()=>[],body:{appendChild(){}}}, window:{addEventListener(){},matchMedia:()=>({matches:false})}, localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(failWrites)throw new Error('Quota exceeded');values.set(key,value);}}, Blob,URL,FileReader:class { readAsText(file){this.onload({target:{result:file.text}});} }});
  vm.runInContext(source,context);
  return {values,element,run:code=>vm.runInContext(code,context),read:code=>JSON.parse(vm.runInContext(`JSON.stringify(${code})`,context)),fail:()=>{failWrites=true;}};
}
const oldWorkout = {id:1,date:'2026-09-18',exercises:[{name:'Bench press',usesBar:true,barWeight:20,sets:[{plates:30,reps:8,total:50}]}]};
const backup = {version:3,sessions:[oldWorkout],exercises:['Bench press'],exMeta:{'Bench press':{usesBar:true,barWeight:20}}};
function draft(a,name='Bench press') {
  a.element('exercise-select').value=name;a.run('addExerciseBlock()');
}
function set(a,w='30',r='8',name='Bench press') {
  const i=a.run(`Object.keys(state.draft).indexOf(${JSON.stringify(name)})`);
  a.element(`w-${i}`).value=w;a.element(`r-${i}`).value=r;a.run(`addSet(${JSON.stringify(name)})`);
}
test('finishing commits every exercise and atomically clears the draft',()=>{
  const a=app();draft(a);set(a);draft(a,'Squat');set(a,'40','5','Squat');a.run('finishDay()');
  assert.equal(a.read('state.sessions[0].exercises').length,2);assert.deepEqual(a.read('state.draft'),{});
  const stored=JSON.parse(a.values.get('gym_state_v4'));assert.equal(stored.sessions.length,1);assert.deepEqual(stored.draft,{});
});
test('storage failure leaves history and draft unchanged, including on finish',()=>{
  const a=app();draft(a);set(a);const previous=a.values.get('gym_state_v4');a.fail();a.run('finishDay()');
  assert.equal(a.read('state.sessions').length,0);assert.equal(a.read('state.draft["Bench press"].sets').length,1);assert.equal(a.values.get('gym_state_v4'),previous);
  assert.match(a.element('storage-status').textContent,/Could not save/);
});
test('legacy saved and unsaved sets both migrate; original keys are untouched',()=>{
  const raw=JSON.stringify({'Bench press':{sets:[{plates:30,reps:8}],savedIndividually:true},Squat:{sets:[{plates:40,reps:5}],savedIndividually:false}});
  const a=app({gym_draft:raw});a.run('finishDay()');assert.equal(a.read('state.sessions[0].exercises').length,2);assert.equal(a.values.get('gym_draft'),raw);
});
test('draft date and in-progress input survive a reload',()=>{
  const a=app();draft(a);a.run("change(next=>{next.draftDate='2026-09-10';next.draft['Bench press'].inputWeight='32.5';},false)");
  const b=app(Object.fromEntries(a.values));assert.equal(b.read('state.draftDate'),'2026-09-10');assert.equal(b.read('state.draft["Bench press"].inputWeight'),'32.5');
});
test('rejects negative, nonfinite, empty and fractional rep input',()=>{
  const a=app();draft(a);
  for(const [w,r] of [['-1','8'],['1','0'],['1','1.5'],['','8'],['Infinity','8'],['1',''],['1','-1']]) set(a,w,r);
  assert.equal(a.read('state.draft["Bench press"].sets').length,0);set(a,'0','1');assert.equal(a.read('state.draft["Bench press"].sets').length,1);
});
test('special names are rendered as text with no generated name-based handlers',()=>{
  const a=app();for(const name of ["Farmer's carry",'<img src=x onerror=alert(1)>','__proto__','constructor']){
    a.element('new-exercise').value=name;a.run('addNewExercise()');draft(a,name);set(a,'10','8',name);
  }
  const html=a.element('session-exercises').innerHTML;assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('onclick='));
  a.run('finishDay()');assert.equal(a.read('state.sessions[0].exercises').length,4);
});
test('version 3 imports preserve history, while version 4 also round-trips draft',()=>{
  const a=app();a.run(`state=normalizeData(${JSON.stringify(backup)})`);draft(a);set(a);
  a.run('state=normalizeData(JSON.parse(JSON.stringify(state)))');assert.deepEqual(a.read('state.sessions'),[oldWorkout]);assert.equal(a.read('state.draft["Bench press"].sets').length,1);
});
test('rejects unsupported and malformed backups before replacing data',()=>{
  const a=app();const invalid=[{...backup,version:5},{...backup,exercises:'bad'},{...backup,sessions:[{...oldWorkout,date:'2026-02-30'}]},{...backup,sessions:[oldWorkout,oldWorkout]}];
  const badSet=JSON.parse(JSON.stringify(backup));badSet.sessions[0].exercises[0].sets[0].total=999;invalid.push(badSet);
  for(const value of invalid) assert.throws(()=>a.run(`normalizeData(${JSON.stringify(value)})`));
  assert.equal(a.read('state.sessions').length,0);
});
test('restore replaces draft and can undo to the pre-restore state',()=>{
  const a=app();draft(a);set(a);const before=a.read('state');
  a.run(`pendingRestore=normalizeData(${JSON.stringify(backup)});confirmRestore()`);
  assert.equal(a.read('state.sessions').length,1);assert.deepEqual(a.read('state.draft'),{});
  a.run('undoRestore()');assert.deepEqual(a.read('state'),before);
});
test('failed restore does not replace the current in-memory or persisted state',()=>{
  const a=app();draft(a);set(a);const before=a.read('state');const saved=a.values.get('gym_state_v4');a.fail();
  a.run(`pendingRestore=normalizeData(${JSON.stringify(backup)});confirmRestore()`);
  assert.deepEqual(a.read('state'),before);assert.equal(a.values.get('gym_state_v4'),saved);
});
test('invalid newly selected backup cannot restore a previous valid selection',()=>{
  const a=app();a.run(`previewRestore({target:{files:[{text:${JSON.stringify(JSON.stringify(backup))}}]}})`);assert.equal(a.read('pendingRestore.sessions').length,1);
  a.run(`previewRestore({target:{files:[{text:'invalid'}]}})`);assert.equal(a.read('pendingRestore'),null);a.run('confirmRestore()');assert.equal(a.read('state.sessions').length,0);
});
test('edit completed workout replaces it without duplicating and preserves original until save',()=>{
  const a=app({gym_sessions:JSON.stringify([oldWorkout])});a.run('editWorkout(0)');a.run('sessionAction("Bench press","edit-set",0)');set(a,'40','10');
  assert.equal(a.read('state.sessions[0].exercises[0].sets[0].total'),50);a.run('finishDay()');
  assert.equal(a.read('state.sessions').length,1);assert.equal(a.read('state.sessions[0].id'),1);assert.equal(a.read('state.sessions[0].exercises[0].sets[0].total'),60);
});
test('repeat set, cancel set edit and cancel workout edits',()=>{
  const a=app({gym_sessions:JSON.stringify([oldWorkout])});a.run('editWorkout(0);sessionAction("Bench press","repeat-set",0)');assert.equal(a.read('state.draft["Bench press"].sets').length,2);
  a.run('sessionAction("Bench press","edit-set",0);sessionAction("Bench press","cancel-set",0);cancelEdit()');assert.deepEqual(a.read('state.sessions'),[oldWorkout]);assert.deepEqual(a.read('state.draft'),{});
});
test('finish does not discard a partially typed or pending edited set',()=>{
  const a=app();draft(a);set(a);a.run('sessionAction("Bench press","edit-set",0);finishDay()');assert.equal(a.read('state.sessions').length,0);assert.equal(a.read('state.draft["Bench press"].sets').length,1);
});
test('corrupt saved data is preserved and further writes are blocked',()=>{
  const a=app({gym_sessions:'{broken'});draft(a);assert.equal(a.values.get('gym_sessions'),'{broken');assert.ok(!a.values.has('gym_state_v4'));assert.equal(a.run('storageBlocked'),true);
});
test('another tab cannot silently overwrite newer data',()=>{
  const a=app();draft(a);a.values.set('gym_state_v4','new value');set(a);assert.equal(a.read('state.draft["Bench press"].sets').length,0);assert.equal(a.values.get('gym_state_v4'),'new value');
});
test('local date uses the Colombo calendar at the UTC day boundary',()=>{
  const a=app();assert.equal(a.run("localDate(new Date('2026-09-19T01:00:00+05:30'))"),'2026-09-19');
});
test('draft bar settings survive preference changes and exported totals remain consistent',()=>{
  const a=app();draft(a);set(a);a.run("change(next=>{next.exMeta['Bench press'].barWeight=10;});finishDay()");assert.equal(a.read('state.sessions[0].exercises[0].sets[0].total'),50);
});
