import assert from 'node:assert/strict';
import test from 'node:test';
import { htmlFieldMode, plainTextToFieldHtml, readPlainHtmlField, updatePlainHtmlField } from '../../src/components/htmlField.ts';

test('plain input encodes literal markup, quotes and ampersands while converting newlines', () => {
  const source = '비교: 2 < 3 & 5 > 4\n"정답" \'단어\'\r\n<script>alert(1)</script>';
  const html = plainTextToFieldHtml(source);
  assert.equal(html, '비교: 2 &lt; 3 &amp; 5 &gt; 4<br>&quot;정답&quot; &#39;단어&#39;<br>&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.deepEqual(readPlainHtmlField(html), { editable: true, text: source.replaceAll('\r\n', '\n') });
});

test('ordinary stored HTML displays line breaks and entities naturally', () => {
  assert.deepEqual(readPlainHtmlField('앞면<BR />둘째 줄<br>Tom &amp; Jerry &lt;3 &#x1F600; &#54620; &nbsp;끝'), { editable: true, text: '앞면\n둘째 줄\nTom & Jerry <3 😀 한 \u00a0끝' });
});

test('a no-op edit retains exact imported bytes including entity spelling and br style', () => {
  const html = ' A&#38;B<BR />C&#x27;D\r\nE&nbsp;F ';
  const plain = readPlainHtmlField(html);
  assert.ok(plain.editable);
  assert.equal(updatePlainHtmlField(html, plain.text), html);
  assert.equal(updatePlainHtmlField(html, plain.text.replaceAll('\n', '\r\n')), html);
});

test('mode changes preserve exact source and cannot silently drop formatting or media', () => {
  const imports = ['<b>굵게</b>', '<i>기울임</i>', '<div style="color:red">내용</div>', '<img src="photo.jpg">', '[sound:word.mp3]', '<svg><text>그림</text></svg>', '<!--note-->plain'];
  for (const value of imports) {
    assert.equal(htmlFieldMode(value, false), 'preview');
    assert.equal(htmlFieldMode(value, true), 'html');
    assert.equal(htmlFieldMode(value, false), 'preview');
    assert.throws(() => updatePlainHtmlField(value, '내용'));
  }
});

test('edited text is safe canonical HTML, while source mode remains explicit', () => {
  const previous = 'term &amp; meaning';
  assert.equal(updatePlainHtmlField(previous, '질문\n한글 뜻 <중요>'), '질문<br>한글 뜻 &lt;중요&gt;');
  assert.equal(htmlFieldMode('', false), 'text');
  assert.equal(htmlFieldMode('A<br>B', false), 'text');
  assert.equal(htmlFieldMode('A<br>B', true), 'html');
});

test('unsupported entity rules use preserved-source preview instead of incorrect text decoding', () => {
  for (const value of ['caf&eacute;', '&#x80;', '&#0;', '&#xD800;', '&#x110000;']) {
    assert.deepEqual(readPlainHtmlField(value), { editable: false, text: null });
    assert.equal(htmlFieldMode(value, false), 'preview');
  }
  assert.deepEqual(readPlainHtmlField('x & y = 2 < 3'), { editable: true, text: 'x & y = 2 < 3' });
});
