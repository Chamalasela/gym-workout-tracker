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
  const badSet=JSON.parse(JSON.stringify(backup));badSet.sessions[0].exercises[0].sets[0].total='not a weight';invalid.push(badSet);
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
test('legacy sets accepted by the old app preserve all history and exercises through migration and reload',()=>{
  const legacy=JSON.parse(JSON.stringify(backup));
  legacy.exercises.push('Custom exercise');
  legacy.sessions[0].exercises[0].sets=[
    {plates:30,reps:0,total:50},
    {plates:30,reps:-1,total:50},
    {plates:-30,reps:8,total:-10},
  ];
  const rawSessions=JSON.stringify(legacy.sessions);
  const a=app({gym_sessions:rawSessions,gym_exercises:JSON.stringify(legacy.exercises),gym_ex_meta:JSON.stringify(legacy.exMeta)});
  assert.equal(a.run('storageBlocked'),false);
  assert.deepEqual(a.read('state.sessions'),legacy.sessions);
  assert.deepEqual(a.read('state.exercises'),legacy.exercises);
  assert.match(a.element('history-list').innerHTML,/Bench press/);
  assert.equal(a.run('persist(state)'),true);
  const reloaded=app(Object.fromEntries(a.values));
  assert.deepEqual(reloaded.read('state.sessions'),legacy.sessions);
  assert.equal(a.values.get('gym_sessions'),rawSessions);
  a.run(`previewRestore({target:{files:[{text:${JSON.stringify(JSON.stringify(legacy))}}]}});confirmRestore()`);
  assert.deepEqual(a.read('state.sessions'),legacy.sessions);
});
test('stored historical totals survive backup import and reload without being silently recalculated',()=>{
  const legacy=JSON.parse(JSON.stringify(backup));
  legacy.sessions[0].exercises[0].sets[0].total=55;
  const a=app();
  a.run(`previewRestore({target:{files:[{text:${JSON.stringify(JSON.stringify(legacy))}}]}})`);
  assert.deepEqual(a.read('pendingRestore.sessions'),legacy.sessions);
  a.run('confirmRestore()');
  const reloaded=app(Object.fromEntries(a.values));
  assert.equal(reloaded.run('storageBlocked'),false);
  assert.deepEqual(reloaded.read('state.sessions'),legacy.sessions);
});
test('legacy backups without exercise metadata restore without losing session bar settings',()=>{
  const legacy=JSON.parse(JSON.stringify(backup));
  delete legacy.exMeta;
  const a=app();
  a.run(`previewRestore({target:{files:[{text:${JSON.stringify(JSON.stringify(legacy))}}]}})`);
  assert.deepEqual(a.read('pendingRestore.sessions'),legacy.sessions);
  a.run('confirmRestore()');
  assert.deepEqual(a.read('state.sessions'),legacy.sessions);
  draft(a);set(a,'10','5');a.run('finishDay()');
  assert.equal(a.read('state.sessions').length,2);
});
test('unversioned backups with the legacy structure restore while unknown explicit versions remain rejected',()=>{
  const legacy=JSON.parse(JSON.stringify(backup));
  delete legacy.version;
  const a=app();
  a.run(`previewRestore({target:{files:[{text:${JSON.stringify(JSON.stringify(legacy))}}]}})`);
  assert.deepEqual(a.read('pendingRestore.sessions'),legacy.sessions);
  a.run('confirmRestore()');
  assert.deepEqual(a.read('state.sessions'),legacy.sessions);
  assert.throws(()=>a.run(`normalizeData(${JSON.stringify({...legacy,version:99})})`));
});
test('an unreadable legacy draft preserves readable history and catalog and still permits backup restore',()=>{
  for(const rawDraft of ['{broken',JSON.stringify({'Bench press':{sets:'bad'}}),JSON.stringify({'Bench press':null})]) {
    const rawSessions=JSON.stringify(backup.sessions);
    const a=app({gym_sessions:rawSessions,gym_exercises:JSON.stringify(backup.exercises),gym_ex_meta:JSON.stringify(backup.exMeta),gym_draft:rawDraft});
    assert.deepEqual(a.read('state.sessions'),backup.sessions);
    assert.deepEqual(a.read('state.exercises'),backup.exercises);
    assert.deepEqual(a.read('state.draft'),{});
    assert.match(a.element('history-list').innerHTML,/Bench press/);
    assert.equal(a.run('storageBlocked'),true);
    assert.equal(a.element('recover-raw').hidden,false);
    assert.equal(a.run('persist(state)'),false);
    assert.ok(!a.values.has('gym_state_v4'));
    assert.equal(a.values.get('gym_draft'),rawDraft);
    a.run(`previewRestore({target:{files:[{text:${JSON.stringify(JSON.stringify(backup))}}]}})`);
    assert.deepEqual(a.read('pendingRestore.sessions'),backup.sessions);
    a.run('confirmRestore()');
    assert.equal(a.run('storageBlocked'),false);
    assert.deepEqual(a.read('state.sessions'),backup.sessions);
    const recovery=JSON.parse(a.values.get('gym_unreadable_recovery'));
    assert.equal(recovery.gym_draft,rawDraft);
    assert.equal(recovery.gym_sessions,rawSessions);
  }
});
test('reviewing previous-version data requires confirmation and preserves current v4 data for undo',()=>{
  const legacy={
    gym_sessions:JSON.stringify(backup.sessions),
    gym_exercises:JSON.stringify(backup.exercises),
    gym_ex_meta:JSON.stringify(backup.exMeta),
    gym_draft:JSON.stringify({Squat:{sets:[{plates:40,reps:5}],savedIndividually:false}}),
  };
  const a=app(legacy);a.run('finishDay()');
  const before=a.read('state');
  assert.equal(before.sessions.length,2);
  const saved=a.values.get('gym_state_v4');
  a.run('previewLegacyRestore()');
  assert.deepEqual(a.read('pendingRestore.sessions'),backup.sessions);
  assert.equal(a.read('pendingRestore.draft.Squat.sets').length,1);
  assert.deepEqual(a.read('state'),before);
  assert.equal(a.values.get('gym_state_v4'),saved);
  assert.ok(!a.values.has('gym_restore_recovery_v4'));
  a.run('cancelRestore()');
  assert.deepEqual(a.read('state'),before);
  assert.equal(a.values.get('gym_state_v4'),saved);
  a.run('previewLegacyRestore();confirmRestore()');
  assert.deepEqual(a.read('state.sessions'),backup.sessions);
  assert.deepEqual(JSON.parse(a.values.get('gym_restore_recovery_v4')),before);
  for(const [key,value] of Object.entries(legacy)) assert.equal(a.values.get(key),value);
  a.run('undoRestore()');
  assert.deepEqual(a.read('state'),before);
  for(const [key,value] of Object.entries(legacy)) assert.equal(a.values.get(key),value);
});
test('unreadable previous-version data never silently replaces current v4 workouts',()=>{
  const a=app();draft(a);set(a);a.run('finishDay()');
  const before=a.read('state'),saved=a.values.get('gym_state_v4');
  a.values.set('gym_sessions','{broken');
  a.run('previewLegacyRestore()');
  assert.equal(a.read('pendingRestore'),null);
  assert.equal(a.element('restore-error').hidden,false);
  a.run('confirmRestore()');
  assert.deepEqual(a.read('state'),before);
  assert.equal(a.values.get('gym_state_v4'),saved);
  assert.equal(a.values.get('gym_sessions'),'{broken');
  a.values.set('gym_sessions',JSON.stringify(backup.sessions));
  a.values.set('gym_draft',JSON.stringify({'Bench press':{sets:'bad'}}));
  a.run('previewLegacyRestore()');
  assert.match(a.element('restore-preview').innerHTML,/unfinished workout is excluded/);
  assert.deepEqual(a.read('pendingRestore.sessions'),backup.sessions);
  assert.deepEqual(a.read('pendingRestore.draft'),{});
  assert.deepEqual(a.read('state'),before);
  assert.equal(a.values.get('gym_state_v4'),saved);
  a.run('confirmRestore()');
  assert.deepEqual(a.read('state.sessions'),backup.sessions);
  assert.equal(a.values.get('gym_draft'),JSON.stringify({'Bench press':{sets:'bad'}}));
  a.run('undoRestore()');
  assert.deepEqual(a.read('state'),before);
});
test('editing history preserves recorded totals unless that particular set is changed',()=>{
  const workout=JSON.parse(JSON.stringify(oldWorkout));
  workout.exercises[0].sets=[{plates:30,reps:8,total:55},{plates:40,reps:5,total:65}];
  const a=app({gym_sessions:JSON.stringify([workout])});
  a.run('editWorkout(0)');
  const resumed=app(Object.fromEntries(a.values));
  resumed.run('finishDay()');
  assert.deepEqual(resumed.read('state.sessions'),[workout]);
  resumed.run('editWorkout(0);sessionAction("Bench press","edit-set",0)');
  set(resumed,'40','10');resumed.run('finishDay()');
  assert.deepEqual(resumed.read('state.sessions[0].exercises[0].sets'),[
    {plates:40,reps:10,total:60},
    {plates:40,reps:5,total:65},
  ]);
});
test('only the logging exercise dropdown sorts alphabetically while the catalog and other dropdowns retain their order',()=>{
  const exercises=['Z press','Bench press','assisted row'];
  const a=app({gym_exercises:JSON.stringify(exercises)});
  assert.deepEqual(a.element('exercise-select').children.map(option=>option.value),['assisted row','Bench press','Z press']);
  assert.deepEqual(a.element('filter-exercise').children.map(option=>option.value),['',...exercises]);
  assert.deepEqual(a.element('progress-exercise').children.map(option=>option.value),exercises);
  assert.deepEqual(a.read('state.exercises'),exercises);
});
test('draft cards and completed workout exercises retain the order they were added',()=>{
  const names=['Squat','Bench press','Deadlift'];
  const a=app();
  for(const name of names) { draft(a,name);set(a,'30','8',name); }
  const draftHTML=a.element('session-exercises').innerHTML;
  assert.ok(draftHTML.indexOf('Squat')<draftHTML.indexOf('Bench press'));
  assert.ok(draftHTML.indexOf('Bench press')<draftHTML.indexOf('Deadlift'));
  assert.deepEqual(a.read('Object.keys(state.draft)'),names);
  a.run('finishDay()');
  assert.deepEqual(a.read('state.sessions[0].exercises.map(ex=>ex.name)'),names);
  const historyHTML=a.element('history-list').innerHTML;
  assert.ok(historyHTML.indexOf('Squat')<historyHTML.indexOf('Bench press'));
  assert.ok(historyHTML.indexOf('Bench press')<historyHTML.indexOf('Deadlift'));
  a.run('editWorkout(0)');
  assert.deepEqual(a.read('Object.keys(state.draft)'),names);
});
test('new sets and repeats stop at three while editing and removing remain available',()=>{
  const a=app();draft(a);
  set(a,'20','10');set(a,'30','8');set(a,'40','6');
  const original=a.read('state.draft["Bench press"].sets');
  set(a,'50','5');a.run('sessionAction("Bench press","repeat-set",0)');
  assert.deepEqual(a.read('state.draft["Bench press"].sets'),original);
  a.run('sessionAction("Bench press","edit-set",0)');set(a,'25','12');
  assert.equal(a.read('state.draft["Bench press"].sets').length,3);
  assert.deepEqual(a.read('state.draft["Bench press"].sets[0]'),{plates:25,reps:12});
  a.run('sessionAction("Bench press","remove-set",1);sessionAction("Bench press","repeat-set",0)');
  assert.deepEqual(a.read('state.draft["Bench press"].sets'),[{plates:25,reps:12},{plates:40,reps:6},{plates:40,reps:6}]);
  a.run('sessionAction("Bench press","repeat-set",0);finishDay()');
  assert.equal(a.read('state.sessions[0].exercises[0].sets').length,3);
});
test('legacy workouts with more than three sets survive restore, editing, reload and finish without truncation',()=>{
  const legacy=JSON.parse(JSON.stringify(backup));
  legacy.sessions[0].exercises[0].sets=Array.from({length:5},(_,i)=>({plates:20+i*5,reps:10-i,total:40+i*5}));
  const a=app();
  a.run(`previewRestore({target:{files:[{text:${JSON.stringify(JSON.stringify(legacy))}}]}});confirmRestore()`);
  assert.deepEqual(a.read('state.sessions'),legacy.sessions);
  assert.match(a.element('history-list').innerHTML,/S5/);
  a.run('editWorkout(0)');
  set(a,'60','5');a.run('sessionAction("Bench press","repeat-set",0)');
  assert.equal(a.read('state.draft["Bench press"].sets').length,5);
  const reloaded=app(Object.fromEntries(a.values));
  assert.equal(reloaded.read('state.draft["Bench press"].sets').length,5);
  reloaded.run('finishDay()');
  assert.deepEqual(reloaded.read('state.sessions'),legacy.sessions);
});
test('legacy drafts above three sets remain intact and permit editing or removing existing sets',()=>{
  const sets=Array.from({length:5},(_,i)=>({plates:20+i*5,reps:10-i}));
  const rawDraft=JSON.stringify({'Bench press':{sets,savedIndividually:false}});
  const a=app({gym_draft:rawDraft});
  assert.deepEqual(a.read('state.draft["Bench press"].sets'),sets);
  assert.equal(a.run('persist(state)'),true);
  const reloaded=app(Object.fromEntries(a.values));
  reloaded.run('finishDay()');
  assert.deepEqual(reloaded.read('state.sessions[0].exercises[0].sets'),sets.map(s=>({...s,total:s.plates+20})));
  assert.equal(a.values.get('gym_draft'),rawDraft);
  a.run('sessionAction("Bench press","edit-set",4)');set(a,'60','5');
  assert.equal(a.read('state.draft["Bench press"].sets').length,5);
  assert.deepEqual(a.read('state.draft["Bench press"].sets[4]'),{plates:60,reps:5});
  a.run('sessionAction("Bench press","remove-set",0);finishDay()');
  assert.equal(a.read('state.sessions[0].exercises[0].sets').length,4);
  assert.equal(a.read('state.sessions[0].exercises[0].sets[3].total'),80);
  assert.equal(a.values.get('gym_draft'),rawDraft);
});
test('expanding or collapsing a card is view-only and never changes saved workout data',()=>{
  const a=app();draft(a);draft(a,'Squat');
  const before=a.read('state'),stored=a.values.get('gym_state_v4');
  a.fail();
  a.run('sessionAction("Bench press","toggle-exercise",0)');
  assert.equal(a.run('expandedExercise'),'Bench press');
  a.run('sessionAction("Bench press","toggle-exercise",0)');
  assert.equal(a.run('expandedExercise'),null);
  a.run('sessionAction("Squat","toggle-exercise",0)');
  assert.equal(a.run('expandedExercise'),'Squat');
  assert.deepEqual(a.read('state'),before);
  assert.equal(a.values.get('gym_state_v4'),stored);
  assert.equal(a.element('storage-status').textContent,'');
});
test('partially typed inputs survive switching cards and remain protected from finish',()=>{
  const a=app();draft(a);set(a);draft(a,'Squat');set(a,'40','5','Squat');
  const input=a.element('session-exercises').listeners.input;
  for(const [field,value] of [['inputWeight','27.5'],['inputReps','12']]) {
    input({target:{dataset:{field},value,closest:()=>({dataset:{exIndex:'0'}})}});
  }
  const stored=a.values.get('gym_state_v4');
  a.run('sessionAction("Bench press","toggle-exercise",0);sessionAction("Squat","toggle-exercise",0);sessionAction("Bench press","toggle-exercise",0)');
  assert.equal(a.read('state.draft["Bench press"].inputWeight'),'27.5');
  assert.equal(a.read('state.draft["Bench press"].inputReps'),'12');
  assert.match(a.element('session-exercises').innerHTML,/value="27\.5"/);
  assert.equal(a.values.get('gym_state_v4'),stored);
  a.run('sessionAction("Squat","toggle-exercise",0);finishDay()');
  assert.equal(a.read('state.sessions').length,0);
  const reloaded=app(Object.fromEntries(a.values));
  assert.equal(reloaded.read('state.draft["Bench press"].inputWeight'),'27.5');
  assert.equal(reloaded.run('expandedExercise'),'Bench press');
});
test('saving a third set advances to the next incomplete exercise and collapses when all are complete',()=>{
  const a=app();draft(a);set(a);set(a);draft(a,'Squat');
  set(a,'40','5','Squat');set(a,'40','5','Squat');set(a,'40','5','Squat');
  draft(a,'Deadlift');set(a,'50','5','Deadlift');
  a.run('sessionAction("Bench press","toggle-exercise",0)');set(a);
  assert.equal(a.run('expandedExercise'),'Deadlift');
  assert.equal(a.read('state.draft["Bench press"].sets').length,3);
  set(a,'50','5','Deadlift');a.run('sessionAction("Deadlift","repeat-set",0)');
  assert.equal(a.run('expandedExercise'),null);
  assert.deepEqual(a.read('Object.values(state.draft).map(block=>block.sets.length)'),[3,3,3]);
});
test('a failed third-set save keeps the existing two sets and the current exercise open',()=>{
  for(const repeat of [false,true]) {
    const a=app();draft(a);set(a);set(a);draft(a,'Squat');
    a.run('sessionAction("Bench press","toggle-exercise",0)');
    const before=a.read('state'),stored=a.values.get('gym_state_v4');
    a.fail();
    if(repeat) a.run('sessionAction("Bench press","repeat-set",0)');
    else set(a,'40','6');
    assert.equal(a.run('expandedExercise'),'Bench press');
    assert.deepEqual(a.read('state'),before);
    assert.equal(a.values.get('gym_state_v4'),stored);
    assert.equal(a.read('state.draft["Bench press"].sets').length,2);
    assert.match(a.element('storage-status').textContent,/Could not save/);
    if(!repeat) { assert.equal(a.element('w-0').value,'40');assert.equal(a.element('r-0').value,'6'); }
  }
});

test('switching cards does not discard on-screen input when its autosave fails',()=>{
  const a=app();draft(a);draft(a,'Squat');
  const before=a.read('state');const saved=a.values.get('gym_state_v4');
  a.run(`document.querySelectorAll = selector => selector.includes('data-field') ? [{value:'42.5',dataset:{field:'inputWeight'},closest(){return {dataset:{exIndex:'1'}};}}] : []`);
  a.fail();a.run('sessionAction("Bench press","toggle-exercise",0)');
  assert.equal(a.run('expandedExercise'),'Squat');assert.deepEqual(a.read('state'),before);assert.equal(a.values.get('gym_state_v4'),saved);
  assert.match(a.element('storage-status').textContent,/Could not save/);
});
