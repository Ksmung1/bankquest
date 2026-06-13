import { ScrollView, StyleSheet, Text, View } from 'react-native';

import ExamMathRenderer from '@/components/math/MathRenderer';

const samples = [
  'If x + 1/x = 3, then find x^3 + 1/x^3.',
  'Find the value of sqrt(25) + 2^3.',
  'If a/b = 2/3, find b/a.',
  'Solve: x^2 - 5x + 6 = 0',
  'If theta = 30, find sin theta.',
  'Find [[x^3 + 1/x^3]] when [[x + 1/x = 3]].',
];

export default function MathDemoPage() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Math Renderer Demo</Text>
      <Text style={styles.note}>
        Future question content should wrap guaranteed math spans in `[[...]]` so fractions, powers, roots, and symbols render consistently across native screens.
      </Text>

      {samples.map((sample) => (
        <View key={sample} style={styles.card}>
          <Text style={styles.label}>Stored text</Text>
          <Text style={styles.raw}>{sample}</Text>
          <Text style={styles.label}>Rendered output</Text>
          <ExamMathRenderer content={sample} fontSize={16} textColor="#1E293B" />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 14,
    backgroundColor: '#EAF3FF',
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#1E293B',
  },
  note: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: '900',
    color: '#2563EB',
    textTransform: 'uppercase',
  },
  raw: {
    fontSize: 13,
    lineHeight: 20,
    color: '#64748B',
  },
});
