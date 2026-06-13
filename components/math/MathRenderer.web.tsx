import { memo, useEffect, useMemo, useState } from 'react';
import { Platform, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { buildMathHtml, shouldRenderMath } from '@/components/math/math-renderer-shared';
import { toPlainMathPreview } from '@/utils/mathText';

export type MathRendererProps = {
  content?: string | null;
  fontSize?: number;
  lineHeight?: number;
  textColor?: string;
  fontFamily?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

function MathRendererComponent({
  content,
  fontSize = 15,
  lineHeight = Math.round(fontSize * 1.45),
  textColor = '#1E293B',
  fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  style,
  textStyle,
  numberOfLines,
}: MathRendererProps) {
  const safeContent = content ?? '';
  const renderMath = shouldRenderMath(safeContent, numberOfLines);
  const [height, setHeight] = useState(lineHeight + 4);

  const html = useMemo(() => {
    if (!renderMath) return '';
    return buildMathHtml({
      content: safeContent,
      fontSize,
      lineHeight,
      textColor,
      fontFamily,
    });
  }, [fontFamily, fontSize, lineHeight, renderMath, safeContent, textColor]);

  useEffect(() => {
    if (!renderMath) return undefined;
    const handler = (event: MessageEvent<{ type?: string; height?: number }>) => {
      if (event.data?.type === 'math-height' && typeof event.data.height === 'number') {
        setHeight(Math.max(lineHeight + 4, event.data.height));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [lineHeight, renderMath]);

  if (!renderMath) {
    return (
      <Text numberOfLines={numberOfLines} style={[{ fontSize, lineHeight, color: textColor }, textStyle]}>
        {toPlainMathPreview(safeContent)}
      </Text>
    );
  }

  return (
    <iframe
      srcDoc={html}
      style={{
        border: '0',
        width: '100%',
        height: `${height}px`,
        background: 'transparent',
        overflow: 'hidden',
        pointerEvents: 'none',
        ...(style as object),
      }}
      scrolling="no"
      sandbox="allow-scripts"
      title={`math-renderer-${Platform.OS}`}
    />
  );
}

const MathRenderer = memo(MathRendererComponent);

export default MathRenderer;
