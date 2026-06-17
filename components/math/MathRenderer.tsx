import { memo, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle, View } from 'react-native';
import { WebView } from 'react-native-webview';

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
  fontFamily = Platform.select({ web: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', default: undefined }),
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
        : Platform.select({ web: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', default: undefined });
  const safeContent = content ?? '';
  const renderMath = !disableMath && shouldRenderMath(safeContent, numberOfLines);
  const [height, setHeight] = useState(resolvedLineHeight + 4);
  const [isReady, setIsReady] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    setRenderFailed(false);
    setIsReady(false);
    setHeight(resolvedLineHeight + 4);
  }, [resolvedLineHeight, safeContent]);

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

  if (!renderMath || renderFailed) {
    return (
      <Text numberOfLines={numberOfLines} style={[{ fontSize: resolvedFontSize, lineHeight: resolvedLineHeight, color: resolvedTextColor }, textStyle]}>
        {toPlainMathPreview(safeContent)}
      </Text>
    );
  }

  return (
    <View pointerEvents="none" style={[styles.container, { minHeight: resolvedLineHeight }, style]}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={{ backgroundColor: 'transparent', height }}
        containerStyle={styles.webviewContainer}
        onMessage={(event) => {
          try {
            const payload = JSON.parse(event.nativeEvent.data);
            if (payload?.type === 'math-height' && typeof payload.height === 'number') {
              setHeight(Math.max(resolvedLineHeight + 4, payload.height));
              return;
            }
            if (payload?.type === 'math-ready') {
              setIsReady(true);
            }
          } catch {
            // Ignore malformed resize messages from the embedded document.
          }
        }}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
        overScrollMode="never"
        bounces={false}
        automaticallyAdjustContentInsets={false}
        onError={() => setRenderFailed(true)}
        onHttpError={() => setRenderFailed(true)}
      />
      {!isReady ? (
        <View style={styles.placeholderOverlay}>
          <Text numberOfLines={numberOfLines} style={[{ fontSize: resolvedFontSize, lineHeight: resolvedLineHeight, color: resolvedTextColor }, textStyle]}>
            {toPlainMathPreview(safeContent)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: 'transparent',
    position: 'relative',
  },
  webviewContainer: {
    backgroundColor: 'transparent',
  },
  placeholderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
  },
});

const MathRenderer = memo(MathRendererComponent);

export default MathRenderer;
