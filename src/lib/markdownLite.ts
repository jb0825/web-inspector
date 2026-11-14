// 서버가 만든 Markdown 문자열(분석 문구, 수정 제안)을 화면에 텍스트로만 보여주기 위한 최소 분해.
// HTML로 바꾸지 않는다. 호출한 쪽이 각 조각을 React 텍스트 노드로 렌더링한다(AGENTS.md 8장).

export type MarkdownBlock = { kind: 'text'; text: string } | { kind: 'code'; lang: string; code: string };

const FENCE = /^```([\w-]*)\s*$/;

/** ``` 펜스를 기준으로 텍스트와 코드 블록으로 나눈다. 닫히지 않은 펜스는 끝까지 코드로 본다 */
export function splitFencedBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let buffer: string[] = [];
  let code: { lang: string; lines: string[] } | null = null;

  const flushText = () => {
    const text = buffer.join('\n').trim();
    if (text) blocks.push({ kind: 'text', text });
    buffer = [];
  };

  for (const line of source.split('\n')) {
    const fence = FENCE.exec(line);
    if (code) {
      if (line.trim() === '```') {
        blocks.push({ kind: 'code', lang: code.lang, code: code.lines.join('\n') });
        code = null;
      } else {
        code.lines.push(line);
      }
    } else if (fence) {
      flushText();
      code = { lang: fence[1] ?? '', lines: [] };
    } else {
      buffer.push(line);
    }
  }
  if (code) blocks.push({ kind: 'code', lang: code.lang, code: code.lines.join('\n') });
  flushText();
  return blocks;
}

export type InlineSegment = { kind: 'text'; text: string } | { kind: 'code'; text: string };

/** `인라인 코드`를 분리한다. 짝이 맞지 않는 백틱은 글자 그대로 둔다 */
export function splitInlineCode(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const pattern = /`([^`]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: 'text', text: text.slice(last, index) });
    segments.push({ kind: 'code', text: match[1] ?? '' });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}
