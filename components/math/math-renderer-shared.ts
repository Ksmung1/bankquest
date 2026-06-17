import { hasMathSegments, tokenizeMathContent } from '@/utils/mathText';

type BuildMathHtmlOptions = {
  content: string;
  fontSize: number;
  lineHeight: number;
  textColor: string;
  fontFamily?: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBodyMarkup(content: string) {
  return tokenizeMathContent(content)
    .map((segment) => {
      if (segment.type === 'text') {
        return `<span class="text-segment">${escapeHtml(segment.content)}</span>`;
      }

      const escapedMath = escapeHtml(segment.content);
      return segment.display
        ? `<div class="math-block">\\[${escapedMath}\\]</div>`
        : `<span class="math-inline">\\(${escapedMath}\\)</span>`;
    })
    .join('');
}

export function shouldRenderMath(content: string, numberOfLines?: number) {
  if (!content.trim()) return false;
  if (typeof numberOfLines === 'number') return false;
  return hasMathSegments(content);
}

export function buildMathHtml({
  content,
  fontSize,
  lineHeight,
  textColor,
  fontFamily,
}: BuildMathHtmlOptions) {
  const bodyMarkup = buildBodyMarkup(content);
  const safeTextColor = escapeHtml(textColor);
  const safeFontFamily = escapeHtml(fontFamily ?? 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: transparent;
        overflow: hidden;
      }
      body {
        color: ${safeTextColor};
        font-size: ${fontSize}px;
        line-height: ${lineHeight}px;
        font-family: ${safeFontFamily};
        word-break: break-word;
        white-space: pre-wrap;
      }
      #math-root {
        display: block;
      }
      .math-block {
        display: block;
        margin: 0.1em 0;
      }
      .math-inline {
        display: inline;
      }
      .katex-display {
        margin: 0.1em 0;
        overflow: hidden;
      }
      .katex {
        font-size: 1em;
      }
    </style>
  </head>
  <body>
    <div id="math-root">${bodyMarkup}</div>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
    <script>
      (function () {
        const postHeight = () => {
          const root = document.getElementById('math-root');
          const rootRect = root ? root.getBoundingClientRect() : null;
          const rootHeight = rootRect ? rootRect.height : 0;
          const scrollHeight = root ? root.scrollHeight : 0;
          const offsetHeight = root ? root.offsetHeight : 0;
          const height = Math.max(rootHeight, scrollHeight, offsetHeight);
          const payload = JSON.stringify({ type: 'math-height', height: Math.ceil(height || ${lineHeight}) });
          if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
            window.ReactNativeWebView.postMessage(payload);
          }
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'math-height', height: Math.ceil(height || ${lineHeight}) }, '*');
          }
        };

        const render = () => {
          if (typeof window.renderMathInElement !== 'function') {
            window.setTimeout(render, 30);
            return;
          }
          window.renderMathInElement(document.getElementById('math-root'), {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '\\\\[', right: '\\\\]', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\\\(', right: '\\\\)', display: false }
            ],
            throwOnError: false,
            strict: 'ignore'
          });
          postHeight();
        };

        window.addEventListener('load', render);
        window.addEventListener('resize', postHeight);
        new MutationObserver(postHeight).observe(document.body, { childList: true, subtree: true, characterData: true });
        if (typeof ResizeObserver === 'function') {
          new ResizeObserver(postHeight).observe(document.body);
        }
        render();
      })();
    </script>
  </body>
</html>`;
}
