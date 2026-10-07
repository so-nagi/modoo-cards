import type { Model } from '../types';
import { isImageOcclusionModel, isTextClozeModel } from '../features/cloze-editor';
import './note-type-help.css';

export function noteTypeLabel(model:Model):string {
  if(isImageOcclusionModel(model))return `이미지 가리기 · ${model.name}`;
  if(isTextClozeModel(model))return `문장 빈칸 · ${model.name}`;
  if(model.templates?.some(template=>/\{\{type:/i.test(template.qfmt)))return `정답 직접 입력 · ${model.name}`;
  if(/optional.*reversed/i.test(model.name))return `역방향 선택 · ${model.name}`;
  if(/reversed/i.test(model.name))return `양방향 카드 · ${model.name}`;
  return model.name==='Basic'?`질문과 정답 · ${model.name}`:model.name;
}

export function noteFieldLabel(model:Model|undefined,name:string,index:number):string {
  if(isImageOcclusionModel(model))return name;
  if(isTextClozeModel(model))return index===0?'빈칸을 만들 문장':/back extra/i.test(name)?'정답 뒤 추가 설명':name;
  if(/^Basic(?:\s|$)/.test(model?.name||''))return index===0?'앞면 · 질문':index===1?'뒷면 · 정답':/add.*reverse/i.test(name)?'역방향 카드 추가':name;
  return name;
}

function guideFor(model:Model|undefined):{title:string;steps:string[];example:string;result:string}{
  if(isImageOcclusionModel(model))return {title:'Image Occlusion · 이미지 가리기',steps:['이미지 가리기 편집기를 열고 사진을 선택합니다.','가릴 부분을 드래그해 박스로 표시합니다.','함께 답할 박스는 선택해 그룹으로 묶고 카드를 만듭니다.'],example:'지도에서 서울과 부산을 각각 박스로 가리기',result:'따로 만든 박스는 각각 한 문제, 같은 그룹의 박스는 함께 가리는 한 문제가 됩니다.'};
  if(isTextClozeModel(model))return {title:'Cloze · 문장 빈칸',steps:['완성된 문장을 입력합니다.','숨길 단어나 구절을 선택하고 힌트를 입력합니다. 힌트는 생략할 수 있습니다.','선택한 부분을 빈칸으로 만듭니다. 문제를 추가하거나 기존 문제와 함께 가릴 수 있습니다.'],example:'대한민국의 수도는 서울이다. → 대한민국의 수도는 [도시 이름]이다.',result:'빈칸 두 개를 별도 문제로 만들면 카드 2장, 같은 문제로 묶으면 카드 1장이 생성됩니다.'};
  if(model?.templates?.some(template=>/\{\{type:/i.test(template.qfmt)))return {title:'Basic (type in the answer) · 정답 직접 입력',steps:['Front에 질문, Back에 정답을 입력합니다.','미리보기에서 질문과 정답을 확인하고 카드를 추가합니다.','복습할 때 정답을 입력한 뒤 정답 보기로 비교합니다.'],example:'Front: apple / Back: 사과',result:'apple을 보고 사과를 직접 입력하는 카드가 생성됩니다.'};
  if(/reversed/i.test(model?.name||'')){const optional=/optional/i.test(model?.name||'')||model?.fields.some(field=>/add.*reverse/i.test(field));return {title:optional?'Basic (optional reversed card) · 선택한 역방향':'Basic (and reversed card) · 양방향',steps:['Front와 Back에 서로 대응하는 내용을 입력합니다.',...(optional?['Add Reverse 필드에 글자를 입력하면 역방향 카드도 생성됩니다. 비워 두면 기본 방향만 만듭니다.']:['한 번 입력하면 기본 방향과 역방향 카드가 함께 생성됩니다.']),'미리볼 카드에서 방향을 선택해 확인합니다.'],example:'Front: apple / Back: 사과',result:optional?'기본 카드: apple → 사과. Add Reverse를 입력하면 사과 → apple도 추가됩니다.':'카드 1: apple → 사과. 카드 2: 사과 → apple.'};}
  return {title:model?.name==='Basic'?'Basic · 질문과 정답':`${model?.name||'Basic'} · 질문과 정답`,steps:['첫 번째 필드에 질문을 입력합니다.','정답 필드에 뜻이나 답을 입력합니다.','앞면·뒷면 미리보기를 확인하고 카드를 추가합니다.'],example:'Front: apple / Back: 사과',result:'apple을 보고 사과를 떠올리는 카드 1장이 생성됩니다. 사용자 지정 유형은 해당 템플릿 규칙을 따릅니다.'};
}

export default function NoteTypeHelp({model}:{model:Model|undefined}){
  const guide=guideFor(model);
  return <section className="note-type-help" aria-label="카드 만드는 방법">
    <div className="note-help-definitions"><div><h2>덱 · 노트 · 카드</h2><p>덱은 카드를 담는 단어장입니다. 노트는 한 번 입력한 원본 내용이며 카드는 그 내용으로 만든 복습 문제입니다.</p></div><div><h2>노트 유형</h2><p>입력할 필드와 카드 생성 규칙입니다. 질문·정답 한 쌍으로 한 장을 만들거나 방향을 바꾼 두 장을 만들 수 있습니다.</p></div><div><h2>미리볼 카드</h2><p>지금 입력한 노트에서 생성될 개별 문제입니다. 만들어질 여러 카드 중 하나를 선택해 확인합니다.</p></div></div>
    <div className="note-help-current"><h2>{guide.title}</h2><ol>{guide.steps.map(step=><li key={step}>{step}</li>)}</ol><div className="note-help-example"><span>입력 예시</span><p>{guide.example}</p></div><p>{guide.result}</p></div>
    <details><summary>유형별 차이 보기</summary><dl className="note-help-types"><div><dt>Basic</dt><dd>질문을 보고 정답을 확인합니다.</dd></div><div><dt>Basic (and reversed card)</dt><dd>질문→정답, 정답→질문 두 방향으로 복습합니다.</dd></div><div><dt>Basic (optional reversed card)</dt><dd>Add Reverse를 입력한 노트만 역방향 카드를 추가합니다.</dd></div><div><dt>Basic (type in the answer)</dt><dd>복습 중 정답을 직접 입력해 비교합니다.</dd></div><div><dt>Cloze</dt><dd>문장 속 선택한 부분을 빈칸으로 가립니다.</dd></div><div><dt>Image Occlusion</dt><dd>이미지 속 선택한 부분을 박스로 가립니다.</dd></div></dl></details>
    <section className="note-help-source" aria-label="HTML로 직접 작성하는 방법">
      <h2>Anki 방식 · HTML로 직접 작성하기</h2>
      <p>일반 입력과 원문 편집은 같은 내용을 편집합니다. HTML은 글자의 서식과 줄바꿈을 정하고 빈칸 문법은 가릴 부분을 정합니다.</p>
      <ol>
        <li><strong>작성</strong> 탭으로 돌아갑니다. 일반 필드는 <strong>HTML 원문</strong>, Cloze의 문장 필드는 <strong>원문 편집</strong>을 누릅니다.</li>
        <li>아래 예시처럼 원문을 입력합니다. 일반 텍스트 입력란에 HTML 태그를 붙여 넣으면 태그 자체가 글자로 표시되므로 원문 모드를 먼저 여세요.</li>
        <li>오른쪽 미리보기에서 <strong>앞면 · 뒷면</strong>과 생성될 카드를 확인한 뒤 추가합니다.</li>
      </ol>
      <div className="note-help-example"><span>Basic · Front 필드의 HTML 예시</span><pre><code>{'<b>apple</b><br>뜻을 입력하세요.'}</code></pre><p><code>{'<b>…</b>'}</code>는 굵게, <code>{'<br>'}</code>은 줄바꿈입니다. Back에는 <code>사과</code>를 입력합니다.</p></div>
      <div className="note-help-example"><span>Cloze · Text 필드의 원문 예시</span><pre><code>{'대한민국의 수도는 {{c1::서울::도시 이름}}이다.<br>일본의 수도는 {{c2::도쿄}}이다.'}</code></pre><p><code>{'{{c1::정답::힌트}}'}</code>는 Anki 빈칸 문법입니다. 힌트는 생략할 수 있습니다. 같은 번호는 한 카드에서 함께 가리고 다른 번호는 별도 카드가 됩니다.</p><p>기본 Cloze 카드의 앞면은 테마색 블록 안에 한 글자당 언더바 하나를 표시합니다. 서울은 <code>__</code>, New York은 <code>___ ____</code>로 표시됩니다. 블록에 마우스를 올리면 공백·HTML 태그를 제외한 글자 수를 확인할 수 있습니다. 힌트는 블록 옆에 유지하고 뒷면에서는 정답을 보여 줍니다.</p></div>
      <details><summary>카드 틀까지 바꾸기 · HTML 템플릿과 CSS</summary>
        <p>작성 중인 카드를 저장하고 왼쪽 메뉴의 <strong>노트 유형</strong>을 엽니다. <strong>노트 유형과 템플릿</strong>에서 유형과 카드 템플릿을 선택한 뒤 <strong>앞면 · 뒷면 · 스타일 (CSS)</strong>을 편집합니다. 필드에는 내용, 템플릿에는 배치, CSS에는 색과 크기를 작성합니다.</p>
        <div className="note-help-example"><span>Basic 기본 템플릿 예시</span><pre><code>{'앞면: {{Front}}\n뒷면: {{FrontSide}}<hr id="answer">{{Back}}'}</code></pre></div>
        <p>Cloze는 앞면과 뒷면에 <code>{'{{cloze:Text}}'}</code>를 사용합니다. 중괄호 안의 필드 이름은 해당 유형의 실제 필드 이름과 일치해야 합니다. 템플릿 변경은 같은 유형을 쓰는 모든 노트에 적용됩니다.</p>
      </details>
      <p className="note-help-links"><a href="https://docs.ankiweb.net/editing.html" target="_blank" rel="noopener noreferrer">Anki 공식 작성 안내</a><a href="https://docs.ankiweb.net/templates/intro.html" target="_blank" rel="noopener noreferrer">Anki 공식 템플릿 안내</a></p>
    </section>
    <p className="note-help-storage">입력 내용은 Anki와 같은 HTML 필드로 저장됩니다. 덱은 .apkg 파일로 내보낼 수 있습니다. 모두카드의 테마 음영은 미리보기와 복습 화면에 적용되며 저장된 원문과 템플릿은 유지됩니다.</p>
  </section>;
}
