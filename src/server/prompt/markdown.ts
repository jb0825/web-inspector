import 'server-only';

// 페이지에서 가져온 문자열(selector, textSnippet, htmlSnippet, 속성값)을 Markdown에 넣는 도구 (PRD 5.9.1).
// 내용은 바꾸지 않고, 구조가 깨지지 않게 줄바꿈과 백틱 구분자만 처리한다.

/** 줄바꿈(CR, LF, CRLF, 유니코드 줄 구분자)을 공백 하나로 바꾼다. 목록 항목과 제목 줄이 끊기지 않게 하기 위해서다 */
export function singleLine(value: string): string {
  return value.replace(/\r\n|[\r\n\u2028\u2029]/g, ' ');
}

/** 문자열 안에서 가장 길게 이어진 백틱 수 */
function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}

/**
 * 인라인 코드. 값 안의 가장 긴 백틱 묶음보다 긴 구분자를 쓴다(CommonMark 6.1).
 * 값이 백틱으로 시작하거나 끝나면 구분자와 붙지 않게 양쪽에 공백을 하나씩 둔다(렌더링 시 한 칸씩 제거된다).
 */
export function inlineCode(value: string): string {
  const text = singleLine(value);
  const fence = '`'.repeat(longestBacktickRun(text) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** 코드 블록. 내용 안의 백틱 묶음보다 긴 구분자(최소 3개)를 쓴다 */
export function codeBlock(language: string, body: string): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1));
  return `${fence}${language}\n${body}\n${fence}`;
}
