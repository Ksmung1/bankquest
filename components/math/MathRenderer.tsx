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
  style,
  textStyle,
  numberOfLines,
}: MathRendererProps) {
  const safeContent = content ?? '';
  const renderMath = shouldRenderMath(safeContent, numberOfLines);
  const [height, setHeight] = useState(lineHeight + 4);
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    setRenderFailed(false);
  }, [safeContent]);

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

  if (!renderMath || renderFailed) {
    return (
      <Text numberOfLines={numberOfLines} style={[{ fontSize, lineHeight, color: textColor }, textStyle]}>
        {toPlainMathPreview(safeContent)}
      </Text>
    );
  }

  return (
    <View pointerEvents="none" style={[styles.container, { minHeight: lineHeight }, style]}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={{ backgroundColor: 'transparent', height }}
        containerStyle={styles.webviewContainer}
        onMessage={(event) => {
          try {
            const payload = JSON.parse(event.nativeEvent.data);
            if (payload?.type === 'math-height' && typeof payload.height === 'number') {
              setHeight(Math.max(lineHeight + 4, payload.height));
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: 'transparent',
  },
  webviewContainer: {
    backgroundColor: 'transparent',
  },
});

const MathRenderer = memo(MathRendererComponent);

export default MathRenderer;
