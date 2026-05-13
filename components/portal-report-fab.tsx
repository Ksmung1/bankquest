import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { submitPortalReport } from '@/lib/portal-bridge';

const initialForm = {
  reportType: 'Bug',
  quality: 'Useful',
  headline: '',
  message: '',
};

export function PortalReportFab() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [form, setForm] = useState(initialForm);
  const webInputReset = Platform.OS === 'web' ? ({ outlineWidth: 0, outlineStyle: 'none', boxShadow: 'none' } as const) : null;

  if (pathname === '/auth' || pathname.startsWith('/admin')) {
    return null;
  }

  async function handleSubmit() {
    if (!form.message.trim()) {
      setErrorMessage('Report message is required.');
      setStatusMessage('');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      await submitPortalReport({
        projectName: 'Bank & SSC',
        reportType: form.reportType,
        quality: form.quality,
        headline: form.headline,
        message: form.message,
      });
      setForm(initialForm);
      setStatusMessage('Report submitted to Website A.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to submit report.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Pressable style={({ pressed }) => [styles.fab, pressed && styles.pressed]} onPress={() => setIsOpen(true)}>
        <MaterialCommunityIcons name="message-alert-outline" size={24} color="#FFFFFF" />
      </Pressable>

      <Modal transparent visible={isOpen} animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>Submit Bank & SSC Report</Text>
              <Pressable onPress={() => setIsOpen(false)}>
                <MaterialCommunityIcons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>

            <View style={styles.row}>
              <TextInput
                value={form.reportType}
                onChangeText={(value) => setForm((current) => ({ ...current, reportType: value }))}
                placeholder="Report type"
                placeholderTextColor="#94A3B8"
                style={[styles.input, webInputReset as any]}
              />
              <TextInput
                value={form.quality}
                onChangeText={(value) => setForm((current) => ({ ...current, quality: value }))}
                placeholder="Quality"
                placeholderTextColor="#94A3B8"
                style={[styles.input, webInputReset as any]}
              />
            </View>

            <TextInput
              value={form.headline}
              onChangeText={(value) => setForm((current) => ({ ...current, headline: value }))}
              placeholder="Headline"
              placeholderTextColor="#94A3B8"
              style={[styles.input, webInputReset as any]}
            />

            <TextInput
              value={form.message}
              onChangeText={(value) => setForm((current) => ({ ...current, message: value }))}
              placeholder="Describe the bug, issue, or suggestion."
              placeholderTextColor="#94A3B8"
              multiline
              style={[styles.input, styles.textarea, webInputReset as any]}
            />

            {statusMessage ? <Text style={styles.success}>{statusMessage}</Text> : null}
            {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

            <Pressable style={({ pressed }) => [styles.submit, (pressed || isSubmitting) && styles.pressed]} onPress={handleSubmit} disabled={isSubmitting}>
              <Text style={styles.submitText}>{isSubmitting ? 'Submitting...' : 'Submit report'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 22,
    bottom: 110,
    zIndex: 200,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FF6B2C',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 5,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 46,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
  },
  textarea: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  submit: {
    backgroundColor: '#FF6B2C',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  success: {
    color: '#15803D',
    fontSize: 13,
    fontWeight: '700',
  },
  error: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.86,
  },
});
