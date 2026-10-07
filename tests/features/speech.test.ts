import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseReadingVoice, createCardReader, speechFailure, type SpeechStatus } from '../../src/features/speech.ts';

const voice = (name:string,lang:string,localService=true,isDefault=false) => ({name,lang,localService,default:isDefault,voiceURI:name} as SpeechSynthesisVoice);
function harness() {
  const statuses:SpeechStatus[]=[], utterances:SpeechSynthesisUtterance[]=[], timers=new Map<number,()=>void>();
  let sequence=0;
  const engine={voices:[voice('English','en-US'),voice('한국어','ko-KR')],paused:false,cancels:0,resumes:0,
    getVoices(){return this.voices;},cancel(){this.cancels++;},resume(){this.resumes++;this.paused=false;},
    speak(utterance:SpeechSynthesisUtterance){utterances.push(utterance);}};
  const reader=createCardReader({synthesis:engine as unknown as SpeechSynthesis,createUtterance:text=>({text} as SpeechSynthesisUtterance),setTimer:callback=>{timers.set(++sequence,callback);return sequence;},clearTimer:id=>{timers.delete(id);}},status=>statuses.push(status));
  const emit=(utterance:SpeechSynthesisUtterance,type:'start'|'end'|'error',error='network')=>{
    const handler=utterance[`on${type}`] as ((event:unknown)=>void)|null;
    handler?.({error});
  };
  const tick=()=>{const entry=timers.entries().next().value;if(entry){timers.delete(entry[0]);entry[1]();}};
  return {reader,engine,statuses,utterances,timers,emit,tick,last:()=>statuses.at(-1)!};
}

test('reading chooses an available local language voice over a network default',()=>{
  const local=voice('Local English','en-GB'),remote=voice('Remote English','en-US',false,true);
  assert.equal(chooseReadingVoice([remote,voice('Korean','ko-KR'),local],'en-US'),local);
  assert.equal(chooseReadingVoice([voice('Korean','ko-KR')],'en-US'),undefined);
  assert.equal(chooseReadingVoice([voice('underscore','en_US')],'en-US')?.name,'underscore');
});

test('speak returning does not report playback; start and end events drive the UI',()=>{
  const h=harness(); h.reader.play('apple');
  assert.equal(h.last().state,'loading');
  assert.equal(h.utterances[0].voice?.name,'English');
  assert.equal(h.utterances[0].volume,1);
  h.emit(h.utterances[0],'start');assert.equal(h.last().state,'speaking');
  h.emit(h.utterances[0],'end');assert.match(h.last().message,/읽기 완료/);assert.equal(h.timers.size,0);
  h.emit(h.utterances[0],'error');assert.equal(h.last().state,'idle');
});

test('a paused engine resumes and Korean uses its matching installed voice',()=>{
  const h=harness();h.engine.paused=true;h.reader.play('사과');
  assert.equal(h.engine.resumes,1);assert.equal(h.utterances[0].lang,'ko-KR');assert.equal(h.utterances[0].voice?.name,'한국어');
});

test('an initially empty voice list allows the browser default and later reads refresh the list',()=>{
  const h=harness();h.engine.voices=[];h.reader.prepare();h.reader.play('apple');
  assert.equal(h.utterances[0].voice,null);
  h.engine.voices=[voice('Loaded English','en-US')];h.reader.play('banana');
  assert.equal(h.utterances[1].voice?.name,'Loaded English');
});

test('a silent start times out with a visible retryable error',()=>{
  const h=harness();h.reader.play('apple');h.tick();h.tick();h.tick();
  assert.equal(h.last().state,'error');assert.match(h.last().message,/시작되지 않았/);assert.equal(h.timers.size,0);
  h.reader.play('apple');h.emit(h.utterances.at(-1)!,'start');assert.equal(h.last().state,'speaking');
});

test('stop and dispose cancel playback and ignore delayed events from an older card',()=>{
  const h=harness();h.reader.play('old');h.reader.stop();assert.equal(h.last().state,'idle');
  h.emit(h.utterances[0],'start');assert.equal(h.last().state,'idle');
  h.reader.play('new');h.emit(h.utterances[0],'error');assert.equal(h.last().state,'loading');
  h.reader.dispose();const count=h.statuses.length;h.emit(h.utterances[1],'end');assert.equal(h.statuses.length,count);assert.equal(h.timers.size,0);
});

test('engine errors and thrown requests surface without pretending to play',()=>{
  const h=harness();h.reader.play('apple');h.emit(h.utterances[0],'error','language-unavailable');
  h.tick();h.emit(h.utterances.at(-1)!,'error','language-unavailable');
  assert.equal(h.last().state,'error');assert.match(h.last().message,/음성이 없습니다/);
  h.engine.speak=()=>{throw new Error('unavailable');};h.reader.play('banana');h.tick();assert.equal(h.last().state,'error');assert.equal(h.timers.size,0);
  assert.match(speechFailure('not-allowed'),/차단/);assert.match(speechFailure('network'),/인터넷/);
});

test('empty cards do not submit a speech request and stalled speech can recover',()=>{
  const h=harness();h.reader.play('   ');assert.equal(h.utterances.length,0);assert.equal(h.last().state,'error');
  h.reader.play('apple');h.emit(h.utterances[0],'start');assert.equal(h.timers.size,1);
  h.timers.values().next().value?.();assert.equal(h.last().state,'error');assert.equal(h.timers.size,0);
});

test('end without a start event does not claim successful playback',()=>{
  const h=harness();h.reader.play('apple');h.emit(h.utterances[0],'end');
  h.tick();h.emit(h.utterances.at(-1)!,'end');
  assert.equal(h.last().state,'error');assert.equal(h.timers.size,0);
});

test('an installed voice that ends before starting falls back to another provider',()=>{
  const h=harness();h.engine.voices.push(voice('Remote English','en-US',false));
  h.reader.play('apple');h.emit(h.utterances[0],'end');h.tick();
  assert.equal(h.utterances[1].voice?.name,'Remote English');
  h.emit(h.utterances[0],'error');assert.equal(h.last().state,'loading');
  h.emit(h.utterances[1],'start');h.emit(h.utterances[1],'end');assert.match(h.last().message,/읽기 완료 · Remote English/);
});

test('stopping a pending fallback prevents any later voice request',()=>{
  const h=harness();h.reader.play('apple');h.emit(h.utterances[0],'end');h.reader.stop();h.tick();
  assert.equal(h.utterances.length,1);assert.equal(h.last().state,'idle');
});

test('blocked playback is reported immediately without cycling through voices',()=>{
  const h=harness();h.reader.play('apple');h.emit(h.utterances[0],'error','not-allowed');h.tick();
  assert.equal(h.utterances.length,1);assert.equal(h.last().state,'error');
});
