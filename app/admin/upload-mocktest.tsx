import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { normalizeMockPayload, type LiveMockPayload } from '@/constants/mock-live-types';
import { invalidateMockTestsCache } from '@/lib/app-data-cache';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';

type ValidationResult = { ok: true } | { ok: false; errors: string[] };
type SelectedMockFile = {
  fileName: string;
  rawJson: string;
  payload: LiveMockPayload;
};

const REQUEST_TIMEOUT_MS = 45000;
const UPSERT_BATCH_SIZE = 5;
const ADMIN_UPLOAD_PASSWORD = '123456';

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function chunkItems<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function dedupeMocksById<T extends { id: string }>(items: T[]) {
  const latestById = new Map<string, T>();
  items.forEach((item) => {
    latestById.set(item.id, item);
  });
  return Array.from(latestById.values());
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function hasOptionalImageFields(value: unknown) {
  if (!isObj(value)) return true;
  if (!('image' in value) && !('imageUrl' in value)) return true;

  const rawImage = value.image;
  const rawImageUrl = value.imageUrl;

  const imageOk =
    rawImage === undefined ||
    typeof rawImage === 'string' ||
    (isObj(rawImage) && typeof rawImage.url === 'string');
  const imageUrlOk = rawImageUrl === undefined || typeof rawImageUrl === 'string';

  return imageOk && imageUrlOk;
}

function validateMockPayload(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObj(raw)) {
    return { ok: false, errors: ['Root must be a JSON object.'] };
  }

  const reqTop = ['testId', 'title', 'exam', 'totalTimeSeconds', 'totalMarks', 'sections'] as const;
  for (const key of reqTop) {
    if (!(key in raw)) errors.push(`Missing top-level field: ${key}`);
  }

  if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
    errors.push('sections must be a non-empty array.');
  } else {
    raw.sections.forEach((sec, i) => {
      if (!isObj(sec)) {
        errors.push(`sections[${i}] must be an object.`);
        return;
      }
      const reqSec = ['sectionId', 'name', 'timeSeconds', 'totalQuestions', 'marksPerQuestion', 'negativeMarking', 'questions'] as const;
      for (const key of reqSec) {
        if (!(key in sec)) errors.push(`sections[${i}] missing field: ${key}`);
      }

      if (!Array.isArray(sec.questions) || sec.questions.length === 0) {
        errors.push(`sections[${i}].questions must be a non-empty array.`);
      } else {
        sec.questions.forEach((item, qi) => {
          if (!isObj(item)) {
            errors.push(`sections[${i}].questions[${qi}] must be an object.`);
            return;
          }

          const validateSingleQuestion = (q: Record<string, unknown>, path: string) => {
            const reqQ = ['id', 'type', 'question', 'options', 'correctAnswer'] as const;
            for (const key of reqQ) {
              if (!(key in q)) errors.push(`${path} missing field: ${key}`);
            }

            if (!hasOptionalImageFields(q)) {
              errors.push(`${path} has an invalid image or imageUrl field.`);
            }

            if (!Array.isArray(q.options) || q.options.length < 2) {
              errors.push(`${path}.options must have at least 2 options.`);
            } else {
              q.options.forEach((opt, oi) => {
                if (!isObj(opt) || !('id' in opt) || !('text' in opt)) {
                  errors.push(`${path}.options[${oi}] must contain id and text.`);
                  return;
                }
                if (!hasOptionalImageFields(opt)) {
                  errors.push(`${path}.options[${oi}] has an invalid image or imageUrl field.`);
                }
              });
            }
          };

          if ('directionId' in item || 'directionText' in item) {
            const reqDirection = ['directionId', 'directionText', 'questions'] as const;
            for (const key of reqDirection) {
              if (!(key in item)) errors.push(`sections[${i}].questions[${qi}] missing field: ${key}`);
            }

            if (!hasOptionalImageFields(item)) {
              errors.push(`sections[${i}].questions[${qi}] has an invalid image or imageUrl field.`);
            }

            if (!Array.isArray(item.questions) || item.questions.length === 0) {
              errors.push(`sections[${i}].questions[${qi}].questions must be a non-empty array.`);
              return;
            }

            item.questions.forEach((child, childIndex) => {
              if (!isObj(child)) {
                errors.push(`sections[${i}].questions[${qi}].questions[${childIndex}] must be an object.`);
                return;
              }
              validateSingleQuestion(child, `sections[${i}].questions[${qi}].questions[${childIndex}]`);
            });
            return;
          }

          validateSingleQuestion(item, `sections[${i}].questions[${qi}]`);
        });
      }
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

export default function UploadMockTestPage() {
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdminVerified, setIsAdminVerified] = useState(false);
  const [fileName, setFileName] = useState('');
  const [payload, setPayload] = useState<LiveMockPayload | null>(null);
  const [selectedMocks, setSelectedMocks] = useState<SelectedMockFile[]>([]);
  const [rawJson, setRawJson] = useState('');
  const [uploading, setUploading] = useState(false);
  const [overrideTitle, setOverrideTitle] = useState('');
  const [overrideExam, setOverrideExam] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const canUpload = useMemo(() => isAdminVerified && (selectedMocks.length > 0 || Boolean(rawJson.trim())) && !uploading, [isAdminVerified, rawJson, selectedMocks.length, uploading]);

  const verifyAdminPassword = () => {
    if (adminPassword !== ADMIN_UPLOAD_PASSWORD) {
      setIsAdminVerified(false);
      setStatusMessage('Admin password is incorrect.');
      Alert.alert('Access denied', 'The admin password you entered is incorrect.');
      return;
    }

    setIsAdminVerified(true);
    setStatusMessage('Admin password verified. You can upload mock tests now.');
  };

  const parseCurrentJson = (): LiveMockPayload => {
    const text = rawJson.trim();
    if (!text) {
      throw new Error('Paste or select a JSON file first.');
    }

    const parsed = JSON.parse(text);
    const check = validateMockPayload(parsed);
    if (!check.ok) {
      throw new Error(check.errors.slice(0, 8).join('\n'));
    }

    return normalizeMockPayload(parsed as LiveMockPayload);
  };

  const parseMockText = (text: string): LiveMockPayload => {
    const parsed = JSON.parse(text);
    const check = validateMockPayload(parsed);
    if (!check.ok) {
      throw new Error(check.errors.slice(0, 8).join('\n'));
    }

    return normalizeMockPayload(parsed as LiveMockPayload);
  };

  const pickFile = async () => {
    setStatusMessage(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
      multiple: true,
    });

    if (result.canceled) {
      return;
    }

    try {
      const parsedAssets = await Promise.all(
        result.assets.map(async (asset) => {
          const text = await fetch(asset.uri).then((r) => r.text());
          const nextPayload = parseMockText(text);
          return {
            fileName: asset.name ?? 'selected.json',
            rawJson: text,
            payload: nextPayload,
          } satisfies SelectedMockFile;
        })
      );

      if (parsedAssets.length === 0) {
        setSelectedMocks([]);
        setPayload(null);
        setFileName('');
        setRawJson('');
        setStatusMessage('No JSON files were selected.');
        return;
      }

      const [firstMock] = parsedAssets;
      setSelectedMocks(parsedAssets);
      setPayload(firstMock.payload);
      setRawJson(firstMock.rawJson);
      setFileName(parsedAssets.length === 1 ? firstMock.fileName : `${parsedAssets.length} JSON files selected`);

      if (parsedAssets.length === 1) {
        setOverrideTitle(String(firstMock.payload.title ?? ''));
        setOverrideExam(String(firstMock.payload.exam ?? ''));
        setStatusMessage('JSON validated. Ready to save.');
        Alert.alert('JSON validated', 'Mock test format looks correct. Ready to upload.');
      } else {
        setOverrideTitle('');
        setOverrideExam('');
        setStatusMessage(`${parsedAssets.length} mock tests validated. Ready for bulk upload.`);
        Alert.alert('Bulk JSON validated', `${parsedAssets.length} mock tests are ready to upload.`);
      }
    } catch (e) {
      setSelectedMocks([]);
      setPayload(null);
      const msg = e instanceof Error ? e.message : 'Failed to read or parse file';
      setStatusMessage(`File error: ${msg}`);
      Alert.alert('File error', msg);
    }
  };

  const upload = async () => {
    setUploading(true);
    setStatusMessage(selectedMocks.length > 1 ? `Saving ${selectedMocks.length} mock tests...` : 'Saving mock test...');
    try {
      if (!supabase || !hasSupabaseConfig) {
        throw new Error('Supabase is not configured.');
      }

      if (!isAdminVerified) {
        throw new Error('Enter the admin password to unlock uploads.');
      }

      const { data: sessionData } = await withTimeout(supabase.auth.getSession(), REQUEST_TIMEOUT_MS, 'Session check');
      if (!sessionData.session?.user?.id) {
        throw new Error('No authenticated session was found.');
      }

      const preparedMocks =
        selectedMocks.length > 0
          ? selectedMocks.map((item) => ({
              id: item.payload.testId,
              title: item.payload.title,
              exam: item.payload.exam,
              payload: item.payload,
            }))
          : (() => {
              const parsedPayload = parseCurrentJson();
              setPayload(parsedPayload);
              return [
                {
                  id: parsedPayload.testId,
                  title: overrideTitle.trim() || parsedPayload.title,
                  exam: overrideExam.trim() || parsedPayload.exam,
                  payload: parsedPayload,
                },
              ];
            })();

      if (preparedMocks.length === 1) {
        const [singleMock] = preparedMocks;
        setPayload(singleMock.payload);
      }

      const rows = dedupeMocksById(
        preparedMocks.map((item) => ({
          id: item.id,
          title: item.title,
          exam: item.exam,
          payload: {
            ...item.payload,
            title: item.title,
            exam: item.exam,
          },
          is_active: true,
        }))
      );

      const replacedCount = preparedMocks.length - rows.length;

      const chunks = chunkItems(rows, UPSERT_BATCH_SIZE);
      for (let index = 0; index < chunks.length; index += 1) {
        if (chunks.length > 1) {
          setStatusMessage(`Saving mock tests/PYQs... ${index + 1}/${chunks.length} batches`);
        }

        const { error } = await withTimeout(
          supabase.from('mock_tests').upsert(chunks[index], { onConflict: 'id' }),
          REQUEST_TIMEOUT_MS,
          `Upload batch ${index + 1}`
        );

        if (error) {
          throw new Error(error.message);
        }
      }

      rows.forEach((item) => {
        invalidateMockTestsCache(String(item.id));
      });

      if (rows.length === 1) {
        const [singleMock] = rows;
        setStatusMessage(`Uploaded to live DB: ${singleMock.title} (${singleMock.id})`);
        Alert.alert('Upload complete', `Mock test/PYQ "${singleMock.title}" (${singleMock.id}) saved to the live database. Re-uploading the same testId will replace the existing version.`);
      } else {
        const replacementNote = replacedCount > 0 ? ` ${replacedCount} duplicate testId value(s) in this upload were replaced by the latest version.` : '';
        setStatusMessage(`Uploaded ${rows.length} mock tests/PYQs to the live DB.${replacementNote}`);
        Alert.alert('Bulk upload complete', `${rows.length} mock tests/PYQs were saved to the live database. Any re-upload with the same testId replaces the existing version.${replacementNote}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setStatusMessage(`Save failed: ${msg}`);
      Alert.alert('Upload failed', msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Admin Upload Mock Test</Text>
        <Text style={styles.subtitle}>Upload validated mock tests or PYQs to the live database, one at a time or in bulk.</Text>

        <View style={styles.accessCard}>
          <Text style={styles.accessTitle}>Admin Verification</Text>
          <Text style={styles.accessText}>
            Enter the admin password to unlock uploads for this session on the current screen.
          </Text>
          <TextInput
            value={adminPassword}
            onChangeText={setAdminPassword}
            style={styles.input}
            placeholder="Enter admin password"
            placeholderTextColor="#94A3B8"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable onPress={verifyAdminPassword} style={({ pressed }) => [styles.verifyBtn, pressed && styles.pressed]}>
            <Text style={styles.verifyBtnText}>{isAdminVerified ? 'Verified' : 'Verify Password'}</Text>
          </Pressable>
          <Text style={[styles.accessState, isAdminVerified ? styles.accessStateVerified : styles.accessStateLocked]}>
            {isAdminVerified ? 'Upload access unlocked.' : 'Upload access locked until password is verified.'}
          </Text>
        </View>

        <Pressable onPress={pickFile} style={({ pressed }) => [styles.pickBtn, pressed && styles.pressed]}>
          <Text style={styles.pickBtnText}>Select JSON File(s)</Text>
        </Pressable>

        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Selected file(s)</Text>
          <Text style={styles.infoValue}>{fileName || 'None'}</Text>

          <Text style={styles.infoLabel}>files</Text>
          <Text style={styles.infoValue}>{selectedMocks.length || (rawJson.trim() ? 1 : 0)}</Text>

          <Text style={styles.infoLabel}>preview testId</Text>
          <Text style={styles.infoValue}>{payload?.testId ?? '-'}</Text>

          <Text style={styles.infoLabel}>preview sections</Text>
          <Text style={styles.infoValue}>{payload?.sections?.length ?? 0}</Text>
        </View>

        <Text style={styles.fieldLabel}>Title override</Text>
        <TextInput value={overrideTitle} onChangeText={setOverrideTitle} style={styles.input} placeholder="Use JSON title by default" placeholderTextColor="#94A3B8" />

        <Text style={styles.fieldLabel}>Exam override</Text>
        <TextInput value={overrideExam} onChangeText={setOverrideExam} style={styles.input} placeholder="Use JSON exam by default" placeholderTextColor="#94A3B8" />

        <Pressable disabled={!canUpload} onPress={upload} style={({ pressed }) => [styles.uploadBtn, (!canUpload || pressed) && styles.uploadBtnDisabled]}>
          <Text style={styles.uploadBtnText}>{uploading ? 'Saving...' : selectedMocks.length > 1 ? 'Save All Mock Tests' : 'Save Mock Test'}</Text>
        </Pressable>

        <Text style={styles.hint}>
          {selectedMocks.length > 1
            ? 'Bulk upload uses each file’s own testId, title, and exam. Title/exam overrides apply only to single-test uploads.'
            : canUpload
              ? 'Button saves the JSON currently shown below.'
              : 'Paste or select JSON to enable saving.'}
        </Text>
        {statusMessage ? <Text style={styles.status}>{statusMessage}</Text> : null}

        <Text style={styles.previewTitle}>Raw JSON preview</Text>
        <View style={styles.previewBox}>
          <TextInput
            multiline
            value={rawJson}
            onChangeText={(text) => {
              setSelectedMocks([]);
              setFileName('');
              setRawJson(text);
              setStatusMessage(null);
            }}
            style={styles.previewInput}
            placeholder="Paste mock JSON here if file selection does not work. Editing here switches back to single-test mode."
            placeholderTextColor="#94A3B8"
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#EAF3FF' },
  container: { padding: 16, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: '900', color: '#1E293B' },
  subtitle: { marginTop: 4, fontSize: 13, color: '#64748B', fontWeight: '600', marginBottom: 14 },
  accessCard: { marginBottom: 14, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E2E8F0', gap: 8 },
  accessTitle: { fontSize: 14, fontWeight: '800', color: '#1E293B' },
  accessText: { fontSize: 12, lineHeight: 18, color: '#64748B', fontWeight: '600' },
  verifyBtn: { backgroundColor: '#0F766E', borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  verifyBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  accessState: { fontSize: 12, fontWeight: '700' },
  accessStateVerified: { color: '#0F766E' },
  accessStateLocked: { color: '#B45309' },
  pickBtn: { backgroundColor: '#2563EB', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  pickBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  infoCard: { marginTop: 12, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E2E8F0', gap: 4 },
  infoLabel: { fontSize: 11, color: '#64748B', fontWeight: '700', textTransform: 'uppercase' },
  infoValue: { fontSize: 13, color: '#1E293B', fontWeight: '700' },
  fieldLabel: { marginTop: 12, marginBottom: 6, fontSize: 12, color: '#475569', fontWeight: '700' },
  input: { height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#fff', paddingHorizontal: 12, fontSize: 14, fontWeight: '600', color: '#1E293B' },
  uploadBtn: { marginTop: 14, backgroundColor: '#FF6B2C', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  uploadBtnDisabled: { opacity: 0.5 },
  uploadBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  hint: { marginTop: 8, fontSize: 12, color: '#64748B', fontWeight: '600' },
  status: { marginTop: 8, fontSize: 12, lineHeight: 18, color: '#0F766E', fontWeight: '700' },
  previewTitle: { marginTop: 16, marginBottom: 8, fontSize: 13, color: '#1E293B', fontWeight: '800' },
  previewBox: { backgroundColor: '#0F172A', borderRadius: 10, padding: 10, minHeight: 120 },
  previewInput: { minHeight: 220, color: '#E2E8F0', fontSize: 11, lineHeight: 16, fontFamily: 'monospace', textAlignVertical: 'top' },
  pressed: { opacity: 0.85 },
});
