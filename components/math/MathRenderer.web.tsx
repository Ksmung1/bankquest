import { memo, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle, View } from 'react-native';

import { buildMathHtml, shouldRenderMath } from '@/components/math/math-renderer-shared';
import { toPlainMathPreview } from '@/utils/mathText';

export type MathRendererProps = {
  content?: string | null;
  fontSize?: number;
  lineHeight?: number;
  textColor?: string;
  fontFamily?: string;
  disableMath?: boolean;
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
  disableMath = false,
  style,
  textStyle,
  numberOfLines,
}: MathRendererProps) {
  const resolvedTextStyle = StyleSheet.flatten(textStyle) ?? {};
  const resolvedFontSize = typeof fontSize === 'number' ? fontSize : typeof resolvedTextStyle.fontSize === 'number' ? resolvedTextStyle.fontSize : 15;
  const resolvedLineHeight = typeof lineHeight === 'number' ? lineHeight : typeof resolvedTextStyle.lineHeight === 'number' ? resolvedTextStyle.lineHeight : Math.round(resolvedFontSize * 1.45);
  const resolvedTextColor = typeof textColor === 'string' ? textColor : typeof resolvedTextStyle.color === 'string' ? resolvedTextStyle.color : '#1E293B';
  const resolvedFontFamily =
    typeof fontFamily === 'string'
      ? fontFamily
      : typeof resolvedTextStyle.fontFamily === 'string'
        ? resolvedTextStyle.fontFamily
        : 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const safeContent = content ?? '';
  const renderMath = !disableMath && shouldRenderMath(safeContent, numberOfLines);
  const [height, setHeight] = useState(resolvedLineHeight + 4);
  const [isReady, setIsReady] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);

  const html = useMemo(() => {
    if (!renderMath) return '';
    return buildMathHtml({
      content: safeContent,
      fontSize: resolvedFontSize,
      lineHeight: resolvedLineHeight,
      textColor: resolvedTextColor,
      fontFamily: resolvedFontFamily,
    });
  }, [renderMath, resolvedFontFamily, resolvedFontSize, resolvedLineHeight, resolvedTextColor, safeContent]);

  useEffect(() => {
    setRenderFailed(false);
    setIsReady(false);
    setHeight(resolvedLineHeight + 4);
  }, [resolvedLineHeight, safeContent]);

  useEffect(() => {
    if (!renderMath) return undefined;
    const handler = (event: MessageEvent<{ type?: string; height?: number }>) => {
      if (event.data?.type === 'math-height' && typeof event.data.height === 'number') {
        setHeight(Math.max(resolvedLineHeight + 4, event.data.height));
        return;
      }
      if (event.data?.type === 'math-ready') {
        setIsReady(true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [renderMath, resolvedLineHeight]);

  if (!renderMath || renderFailed) {
    return (
      <Text numberOfLines={numberOfLines} style={[{ fontSize: resolvedFontSize, lineHeight: resolvedLineHeight, color: resolvedTextColor }, textStyle]}>
        {toPlainMathPreview(safeContent)}
      </Text>
    );
  }

  return (
    <div style={{ position: 'relative', minHeight: `${resolvedLineHeight}px`, ...(style as object) }}>
      <iframe
        srcDoc={html}
        style={{
          border: '0',
          width: '100%',
          height: `${height}px`,
          background: 'transparent',
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
        scrolling="no"
        sandbox="allow-scripts"
        title={`math-renderer-${Platform.OS}`}
        onError={() => setRenderFailed(true)}
      />
      {!isReady ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            backgroundColor: 'transparent',
          }}>
          <Text numberOfLines={numberOfLines} style={[{ fontSize: resolvedFontSize, lineHeight: resolvedLineHeight, color: resolvedTextColor }, textStyle]}>
            {toPlainMathPreview(safeContent)}
          </Text>
        </View>
      ) : null}
    </div>
  );
}

const MathRenderer = memo(MathRendererComponent);

export default MathRenderer;
