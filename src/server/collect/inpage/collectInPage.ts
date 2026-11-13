import type { CollectedElement, InPageArgs, InPageResult } from '../types';

/**
 * 브라우저 안에서 실행하는 수집 함수(DETECTION_RULES 3.1~3.5).
 *
 * page.evaluate로 직렬화되어 브라우저에서 실행되므로 완전히 독립적이어야 한다(AGENTS.md 7장).
 * - 바깥 변수, import(타입 제외), 다른 모듈의 함수를 참조하지 않는다. 상수는 args로 받는다.
 * - 헬퍼는 이 함수 본문 안에 둔다.
 * - 측정만 하고 판정하지 않는다. 숫자 반올림은 Node(collect.ts)에서 한다.
 */
export function collectInPage(args: InPageArgs): InPageResult {
  // 측정 기준: 맨 위로 스크롤한 상태(DETECTION_RULES 3.1). smooth 스크롤 CSS를 무시하도록 instant를 쓴다.
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  const root = document.documentElement;
  const body = document.body;

  const generatedId = args.generatedIdPatterns.map((source) => new RegExp(source));
  const unstableClass = args.unstableClassPatterns.map((source) => new RegExp(source));

  // 자신과 자손이 후보가 될 수 없는 태그 (DETECTION_RULES 3.2)
  const EXCLUDED_TAGS = ['script', 'style', 'noscript', 'template'];
  const LANDMARK_TAGS = ['section', 'header', 'footer', 'nav', 'main'];
  const INTERACTIVE_TAGS = ['button', 'select', 'textarea', 'summary'];
  const INTERACTIVE_ROLES = ['button', 'link', 'tab', 'menuitem'];
  const STABLE_ATTRIBUTES = ['id', 'data-testid', 'name', 'aria-label', 'role'];
  const SR_ONLY_CLIP = /^rect\(\s*0(px)?\s*,?\s*0(px)?\s*,?\s*0(px)?\s*,?\s*0(px)?\s*\)$/;

  // ── id / data-testid 개수 (selector 유일성 검사의 사전 필터) ──
  const idCount: Record<string, number> = Object.create(null);
  const testIdCount: Record<string, number> = Object.create(null);
  const all = document.getElementsByTagName('*');
  for (let i = 0; i < all.length; i += 1) {
    const id = all[i].getAttribute('id');
    if (id) idCount[id] = (idCount[id] || 0) + 1;
    const testId = all[i].getAttribute('data-testid');
    if (testId !== null) testIdCount[testId] = (testIdCount[testId] || 0) + 1;
  }

  const px = (value: string): number => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };

  const isUnique = (selector: string): boolean => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };

  const stableClasses = (el: Element): string[] => {
    const out: string[] = [];
    const list = el.classList;
    for (let i = 0; i < list.length; i += 1) {
      const name = list[i];
      if (!unstableClass.some((re) => re.test(name))) out.push(name);
    }
    return out;
  };

  const quote = (value: string): string => value.replace(/["\\]/g, '\\$&');

  // ── Selector (DETECTION_RULES 3.4) ──
  // 같은 조상의 기준점 판정을 반복하지 않도록 요소별로 기억한다. 출력 순서에는 쓰지 않는다.
  const anchorCache = new Map<Element, string | null>();
  const anchorSelectorOf = (el: Element): string | null => {
    const cached = anchorCache.get(el);
    if (cached !== undefined) return cached;
    let result: string | null = null;
    const id = el.getAttribute('id');
    if (id && !generatedId.some((re) => re.test(id)) && idCount[id] === 1) {
      const selector = '#' + CSS.escape(id);
      if (isUnique(selector)) result = selector;
    }
    if (result === null) {
      const testId = el.getAttribute('data-testid');
      if (testId !== null && testIdCount[testId] === 1) {
        const selector = '[data-testid="' + quote(testId) + '"]';
        if (isUnique(selector)) result = selector;
      }
    }
    anchorCache.set(el, result);
    return result;
  };

  const nthOfType = (el: Element): number => {
    let n = 1;
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
      if (s.localName === el.localName) n += 1;
    }
    return n;
  };

  const segmentOf = (el: Element, forceNth: boolean): string => {
    const tag = el.localName;
    const classes = stableClasses(el).slice(0, args.selectorMaxClasses);
    let segment = CSS.escape(tag) + classes.map((c) => '.' + CSS.escape(c)).join('');
    let needsNth = forceNth;
    if (!needsNth && el.parentElement) {
      for (let s = el.parentElement.firstElementChild; s; s = s.nextElementSibling) {
        if (s !== el && s.localName === tag && classes.every((c) => s.classList.contains(c))) {
          needsNth = true;
          break;
        }
      }
    }
    if (needsNth) segment += ':nth-of-type(' + nthOfType(el) + ')';
    return segment;
  };

  const selectorOf = (el: Element): string => {
    const own = anchorSelectorOf(el);
    if (own !== null) return own;

    const chain: Element[] = [];
    let anchor = 'body';
    let cur: Element | null = el;
    while (cur && cur !== body && cur !== root) {
      if (cur !== el) {
        const a = anchorSelectorOf(cur);
        if (a !== null) {
          anchor = a;
          break;
        }
      }
      chain.unshift(cur);
      cur = cur.parentElement;
    }

    const build = (forceNth: boolean): string => {
      const segments = chain.map((e) => segmentOf(e, forceNth));
      // 5단계를 넘으면 기준점 없이 마지막 5단계만 쓴다(DETECTION_RULES 3.4)
      if (segments.length > args.selectorPathMaxDepth) {
        return segments.slice(segments.length - args.selectorPathMaxDepth).join(' > ');
      }
      return [anchor].concat(segments).join(' > ');
    };

    const first = build(false);
    if (isUnique(first)) return first;
    return build(true);
  };

  // ── Source Hints (DETECTION_RULES 3.5) ──
  const normalizeSpace = (text: string): string => text.replace(/\s+/g, ' ').trim();

  /** textContent 전체를 만들지 않고 앞부분만 읽는다(큰 컨테이너에서 비용을 줄이기 위해). */
  const textSnippetOf = (el: Element, max: number): string => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let buffer = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const data = (node as Text).data;
      buffer += /\S/.test(data) ? data : ' ';
      if (normalizeSpace(buffer).length > max) break;
    }
    return normalizeSpace(buffer).slice(0, max);
  };

  const landmarkCache = new Map<Element, string>();
  const landmarkOf = (el: Element): string | undefined => {
    let lm: Element | null = el.parentElement;
    while (lm && LANDMARK_TAGS.indexOf(lm.localName) === -1) lm = lm.parentElement;
    if (!lm) return undefined;
    const cached = landmarkCache.get(lm);
    if (cached !== undefined) return cached;
    let value = '';
    const id = lm.getAttribute('id');
    const label = lm.getAttribute('aria-label');
    if (id && id.trim()) value = id.trim();
    else if (label && normalizeSpace(label)) value = normalizeSpace(label);
    else {
      const heading = lm.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      if (heading) value = textSnippetOf(heading, args.landmarkMax);
    }
    value = value ? value.slice(0, args.landmarkMax) : lm.localName;
    landmarkCache.set(lm, value);
    return value;
  };

  const htmlSnippetOf = (el: Element): string => {
    let out = '<' + el.localName;
    for (let i = 0; i < el.attributes.length; i += 1) {
      const attr = el.attributes[i];
      const value = attr.value.slice(0, args.htmlAttributeValueMax).replace(/"/g, '&quot;');
      out += ' ' + attr.name + '="' + value + '"';
    }
    out += '>';
    return out.slice(0, args.htmlSnippetMax);
  };

  const ancestorPathOf = (el: Element): string => {
    const parts: string[] = [];
    for (let a = el.parentElement; a && a !== root && parts.length < args.ancestorPathMaxDepth; a = a.parentElement) {
      parts.unshift([a.localName].concat(stableClasses(a).slice(0, args.selectorMaxClasses)).join('.'));
    }
    return parts.join(' > ');
  };

  const sourceHintsOf = (el: Element): CollectedElement['sourceHints'] => {
    const stableAttributes: Record<string, string> = {};
    for (const name of STABLE_ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (value) stableAttributes[name] = value;
    }
    const hints: CollectedElement['sourceHints'] = {
      htmlSnippet: htmlSnippetOf(el),
      stableAttributes,
      ancestorPath: ancestorPathOf(el),
    };
    const text = textSnippetOf(el, args.textSnippetMax);
    if (text) hints.textSnippet = text;
    const landmark = landmarkOf(el);
    if (landmark !== undefined) hints.landmark = landmark;
    return hints;
  };

  // ── 측정 헬퍼 ──
  const range = document.createRange();
  const textRectsOf = (el: Element) => {
    const out: CollectedElement['textRects'] = [];
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== Node.TEXT_NODE || !/\S/.test((child as Text).data)) continue;
      range.selectNodeContents(child);
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i += 1) {
        const r = rects[i];
        if (r.width > 0 && r.height > 0) {
          out.push({ x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height });
        }
      }
    }
    return out;
  };

  const isInteractive = (el: Element): boolean => {
    const tag = el.localName;
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.indexOf(role) !== -1) return true;
    if (INTERACTIVE_TAGS.indexOf(tag) !== -1) return true;
    if (tag === 'a') return el.hasAttribute('href');
    if (tag === 'input') return (el.getAttribute('type') || '').toLowerCase() !== 'hidden';
    return false;
  };

  const countDescendants = (el: Element): number => el.getElementsByTagName('*').length;

  // ── 순회 (DETECTION_RULES 3.2) ──
  interface Frame {
    el: Element;
    candidateAncestors: number[]; // 가까운 순
    inNav: boolean;
    fixedOrSticky: boolean;
    hasFixedAncestor: boolean;
    ariaHidden: boolean;
  }

  const elements: CollectedElement[] = [];
  let totalCandidates = 0;
  let index = 0;
  const stack: Frame[] = [
    {
      el: root,
      candidateAncestors: [],
      inNav: false,
      fixedOrSticky: false,
      hasFixedAncestor: false,
      ariaHidden: false,
    },
  ];

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    const el = frame.el;
    const myIndex = index;
    index += 1;

    const tag = el.localName;
    const isRoot = el === root || el === body;
    const cs = getComputedStyle(el);

    // 자신과 자손이 모두 후보가 될 수 없으면 자손은 개수만 세고 건너뛴다(index는 유지).
    const opacityZero = px(cs.opacity) === 0 && cs.opacity.trim() !== '';
    const srOnly = SR_ONLY_CLIP.test(cs.clip) || cs.clipPath === 'inset(50%)';
    const skipSubtree =
      !isRoot &&
      (EXCLUDED_TAGS.indexOf(tag) !== -1 ||
        cs.display === 'none' ||
        // 자신 또는 조상의 opacity가 0이면 후보가 아니다(PRD 10장, opacity는 상속되지 않으므로 자손도 뺀다)
        opacityZero ||
        // PRD 5.3.1: 스크린리더 전용 요소 제외 (자신 또는 조상)
        srOnly ||
        frame.ariaHidden);
    if (skipSubtree) {
      index += countDescendants(el);
      continue;
    }

    const position = cs.position;
    const isFixed = position === 'fixed';
    const fixedOrSticky = frame.fixedOrSticky || isFixed || position === 'sticky';

    let isCandidate = false;
    let rect: DOMRect | null = null;
    if (!isRoot && cs.visibility !== 'hidden') {
      rect = el.getBoundingClientRect();
      isCandidate = rect.width > args.minElementSizePx && rect.height > args.minElementSizePx;
    }

    if (isCandidate && rect) {
      totalCandidates += 1;
      if (elements.length < args.maxCandidates) {
        const bl = px(cs.borderLeftWidth);
        const br = px(cs.borderRightWidth);
        const bt = px(cs.borderTopWidth);
        const bb = px(cs.borderBottomWidth);
        const x = rect.left + scrollX;
        const y = rect.top + scrollY;
        const role = el.getAttribute('role');

        const computedStyle: Record<string, string> = {};
        for (const property of args.computedStyleProperties) {
          computedStyle[property] = cs.getPropertyValue(property);
        }

        const identity: CollectedElement['identity'] = {};
        const id = el.getAttribute('id');
        if (id) identity.id = id;
        const testId = el.getAttribute('data-testid');
        if (testId !== null) identity.testId = testId;

        elements.push({
          index: myIndex,
          parentIndex: frame.candidateAncestors.length > 0 ? frame.candidateAncestors[0] : null,
          ancestorIndices: frame.candidateAncestors.slice(),
          tag,
          rect: { x, y, width: rect.width, height: rect.height },
          paddingBox: {
            x: x + bl,
            y: y + bt,
            width: Math.max(0, rect.width - bl - br),
            height: Math.max(0, rect.height - bt - bb),
          },
          textRects: textRectsOf(el),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          style: {
            position,
            overflowX: cs.overflowX,
            overflowY: cs.overflowY,
            textOverflow: cs.textOverflow,
            webkitLineClamp: cs.getPropertyValue('-webkit-line-clamp'),
            whiteSpace: cs.whiteSpace,
            lineHeight: cs.lineHeight,
            backgroundColor: cs.backgroundColor,
            backgroundImage: cs.backgroundImage,
            borderWidthSum: bl + br + bt + bb,
            paddingSum: px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.paddingTop) + px(cs.paddingBottom),
          },
          flags: {
            interactive: isInteractive(el),
            heading: /^h[1-6]$/.test(tag) || role === 'heading',
            inNav: frame.inNav,
            fixedOrSticky,
            fixedRoot: isFixed && !frame.hasFixedAncestor,
          },
          computedStyle,
          selector: selectorOf(el),
          sourceHints: sourceHintsOf(el),
          identity,
        });
      }
    }

    // svg 요소 자신은 후보가 될 수 있지만 그 안의 요소는 후보가 아니다(DETECTION_RULES 3.2)
    if (tag === 'svg') {
      index += countDescendants(el);
      continue;
    }

    const role = el.getAttribute('role');
    const candidateAncestors = isCandidate ? [myIndex].concat(frame.candidateAncestors) : frame.candidateAncestors;
    const inNav = frame.inNav || tag === 'nav' || role === 'navigation';
    const hasFixedAncestor = frame.hasFixedAncestor || isFixed;
    // 조상의 aria-hidden="true"만 본다(DETECTION_RULES 3.2). frame.ariaHidden이면 이미 위에서 건너뛰었다.
    const ariaHidden = el.getAttribute('aria-hidden') === 'true';
    // preorder: 첫 자식이 먼저 나오도록 역순으로 넣는다. 객체 spread는 번들러 헬퍼로 바뀔 수 있어 쓰지 않는다.
    for (let child = el.lastElementChild; child; child = child.previousElementSibling) {
      stack.push({ el: child, candidateAncestors, inNav, fixedOrSticky, hasFixedAncestor, ariaHidden });
    }
  }

  const bodyStyle = body ? getComputedStyle(body) : null;
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    layoutWidth: root.clientWidth,
    documentScrollWidth: root.scrollWidth,
    documentHeight: root.scrollHeight,
    hasMetaViewport: document.querySelector('meta[name="viewport"]') !== null,
    rootOverflowX: { html: getComputedStyle(root).overflowX, body: bodyStyle ? bodyStyle.overflowX : 'visible' },
    hasCanvas: document.querySelector('canvas') !== null,
    totalCandidates,
    elements,
  };
}
