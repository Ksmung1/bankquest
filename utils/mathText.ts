// Prefer saving future mock questions with [[...]] around math spans.
// Example: `Find [[x^3 + 1/x^3]] when [[x + 1/x = 3]].`
export type MathSegment = {
  type: 'text' | 'math';
  content: string;
  display?: boolean;
  explicit?: boolean;
};

const EXPLICIT_MATH_REGEX = /\[\[([\s\S]+?)\]\]|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;
const MATH_CANDIDATE_REGEX = /\b(?:sqrt\([^()]+\)|root\([^()]+,[^()]+\)|(?:sin|cos|tan|cot|sec|cosec|log|ln)\s+[A-Za-z0-9]+|(?:angle|triangle)\s+[A-Z]{2,4}|(?:[A-Za-z0-9()]+(?:\s*\/\s*[A-Za-z0-9()]+)?(?:\s*\^\s*-?[A-Za-z0-9()]+)?)(?:\s*(?:\+|-|\*|\/|=|<=|>=|!=|<|>)\s*(?:sqrt\([^()]+\)|root\([^()]+,[^()]+\)|(?:sin|cos|tan|cot|sec|cosec|log|ln)\s+[A-Za-z0-9]+|(?:angle|triangle)\s+[A-Z]{2,4}|[A-Za-z0-9()]+(?:\s*\/\s*[A-Za-z0-9()]+)?(?:\s*\^\s*-?[A-Za-z0-9()]+)?))+|[A-Za-z0-9()]+\s*\/\s*[A-Za-z0-9()]+|[A-Za-z0-9()]+\s*\^\s*-?[A-Za-z0-9()]+)/g;
const MATH_HINT_REGEX = /(<=|>=|!=|=|\+|-|\*|\/|\^|sqrt\(|root\(|\b(?:sin|cos|tan|cot|sec|cosec|log|ln|theta|alpha|beta|gamma|delta|pi|angle|triangle)\b)/i;
const LATEX_COMMAND_REGEX = /\\[A-Za-z]+/;
const GREEK_WORDS = ['alpha', 'beta', 'gamma', 'delta', 'theta', 'pi'] as const;

function stripOuterParens(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isLikelyMathExpression(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 3) return false;
  if (!MATH_HINT_REGEX.test(trimmed)) return false;
  return /[A-Za-z0-9]/.test(trimmed);
}

function splitPlainTextIntoSegments(value: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let cursor = 0;

  for (const match of value.matchAll(MATH_CANDIDATE_REGEX)) {
    const rawMatch = match[0];
    if (!rawMatch) continue;

    const start = match.index ?? 0;
    const end = start + rawMatch.length;
    let candidate = rawMatch;
    let leading = '';
    let trailing = '';

    while (/^[([{"']/.test(candidate)) {
      leading += candidate[0];
      candidate = candidate.slice(1);
    }
    while (/[.,;:!?'"\\]$/.test(candidate)) {
      trailing = candidate.slice(-1) + trailing;
      candidate = candidate.slice(0, -1);
    }

    if (!isLikelyMathExpression(candidate)) continue;

    const adjustedStart = start + leading.length;
    const adjustedEnd = end - trailing.length;

    if (adjustedStart > cursor) {
      segments.push({ type: 'text', content: value.slice(cursor, adjustedStart) });
    }
    segments.push({ type: 'math', content: normalizeMathExpression(candidate) });
    cursor = adjustedEnd;
  }

  if (cursor < value.length) {
    segments.push({ type: 'text', content: value.slice(cursor) });
  }

  return segments.length ? segments : [{ type: 'text', content: value }];
}

export function normalizeMathExpression(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (LATEX_COMMAND_REGEX.test(trimmed)) return trimmed;

  let output = trimmed;

  output = output.replace(/\broot\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/gi, (_, degree: string, radicand: string) => {
    return `\\sqrt[${normalizeMathExpression(degree)}]{${normalizeMathExpression(radicand)}}`;
  });

  output = output.replace(/\bsqrt\(\s*([^)]+?)\s*\)/gi, (_, inner: string) => {
    return `\\sqrt{${normalizeMathExpression(inner)}}`;
  });

  output = output.replace(/\b(angle|triangle)\s+([A-Z]{2,4})\b/gi, (_, keyword: string, value: string) => {
    return `\\${keyword.toLowerCase()} ${value}`;
  });

  output = output.replace(/\b(sin|cos|tan|cot|sec|cosec|log|ln)\b/gi, (_, fn: string) => `\\${fn.toLowerCase()}`);

  for (const word of GREEK_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    output = output.replace(regex, `\\${word}`);
  }

  output = output
    .replace(/<=/g, ' \\leq ')
    .replace(/>=/g, ' \\geq ')
    .replace(/!=/g, ' \\neq ')
    .replace(/\*/g, ' \\times ');

  output = output.replace(/([A-Za-z0-9)}\]])\s*\^\s*(-?[A-Za-z0-9]+|\([^()]+\))/g, (_, base: string, exponent: string) => {
    return `${base}^{${stripOuterParens(exponent)}}`;
  });

  let previous = '';
  while (previous !== output) {
    previous = output;
    output = output.replace(
      /(\([^()]+\)|[A-Za-z0-9]+(?:\^{[^}]+})?)\s*\/\s*(\([^()]+\)|[A-Za-z0-9]+(?:\^{[^}]+})?)/g,
      (_, numerator: string, denominator: string) => `\\frac{${stripOuterParens(numerator)}}{${stripOuterParens(denominator)}}`
    );
  }

  output = output.replace(/\s+/g, ' ').trim();
  return output;
}

export function tokenizeMathContent(content: string): MathSegment[] {
  if (!content) return [{ type: 'text', content: '' }];

  const segments: MathSegment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(EXPLICIT_MATH_REGEX)) {
    const full = match[0];
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push(...splitPlainTextIntoSegments(content.slice(cursor, start)));
    }

    if (match[1] !== undefined) {
      segments.push({ type: 'math', content: normalizeMathExpression(match[1]), explicit: true });
    } else if (match[2] !== undefined) {
      segments.push({ type: 'math', content: normalizeMathExpression(match[2]), display: true, explicit: true });
    } else if (match[3] !== undefined) {
      segments.push({ type: 'math', content: normalizeMathExpression(match[3]), display: true, explicit: true });
    } else if (match[4] !== undefined) {
      segments.push({ type: 'math', content: normalizeMathExpression(match[4]), explicit: true });
    } else if (match[5] !== undefined) {
      segments.push({ type: 'math', content: normalizeMathExpression(match[5]), explicit: true });
    }

    cursor = start + full.length;
  }

  if (cursor < content.length) {
    segments.push(...splitPlainTextIntoSegments(content.slice(cursor)));
  }

  return segments.length ? segments : [{ type: 'text', content }];
}

export function hasMathSegments(content: string) {
  return tokenizeMathContent(content).some((segment) => segment.type === 'math');
}

export function toPlainMathPreview(content: string) {
  return content.replace(/\[\[([\s\S]+?)\]\]/g, '$1');
}
