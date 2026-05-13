export type LiveImageSource = string | { url: string; alt?: string };

export type LiveOption = {
  id: string;
  text: string;
  image?: LiveImageSource;
  imageUrl?: string;
};

export type LiveQuestion = {
  id: string;
  type: string;
  question: string;
  difficulty?: string;
  image?: LiveImageSource;
  imageUrl?: string;
  setId?: string;
  directionId?: string;
  directionText?: string;
  directionQuestionNumber?: number;
  setType?: string;
  options: LiveOption[];
  correctAnswer: string;
  explanation?: string;
  keyPoints?: { option: string; explanation: string }[];
  examInsight?: string;
  commonTrap?: string;
  memoryTrick?: string;
};

export type LiveDirectionSet = {
  directionId: string;
  directionText: string;
  setType?: string;
  image?: LiveImageSource;
  imageUrl?: string;
  questions: LiveQuestion[];
};

export type LiveQuestionItem = LiveQuestion | LiveDirectionSet;

export type LiveSection = {
  sectionId: string;
  name: 'English Language' | 'Quantitative Aptitude' | 'Reasoning Ability' | string;
  timeSeconds: number;
  totalQuestions: number;
  marksPerQuestion: number;
  negativeMarking: number;
  questions: LiveQuestionItem[];
};

export type LiveMockPayload = {
  testId: string;
  title: string;
  exam: string;
  totalTimeSeconds: number;
  totalMarks: number;
  sectionalTiming?: boolean;
  sections: LiveSection[];
};

export type LiveMockListItem = {
  id: string;
  title: string;
  exam: string;
  payload: LiveMockPayload;
  source?: 'live' | 'local';
};

export type FlattenedLiveQuestion = LiveQuestion & {
  sectionId: string;
  sectionName: string;
  questionIndex: number;
  globalIndex: number;
  answerKey: string;
  direction?: {
    directionId: string;
    directionText: string;
    setType?: string;
    imageUrl?: string;
  };
};

export const normalizeSubject = (name: string) => {
  if (name.toLowerCase().includes('english')) return 'English Language';
  if (name.toLowerCase().includes('quant')) return 'Quantitative Aptitude';
  if (name.toLowerCase().includes('reason')) return 'Reasoning';
  return name;
};

export const getImageUrl = (image?: LiveImageSource, imageUrl?: string) => {
  if (typeof imageUrl === 'string' && imageUrl.trim()) return imageUrl.trim();
  if (typeof image === 'string' && image.trim()) return image.trim();
  if (image && typeof image === 'object' && typeof image.url === 'string' && image.url.trim()) {
    return image.url.trim();
  }
  return null;
};

export const isDirectionalQuestionSet = (item: LiveQuestionItem): item is LiveDirectionSet => {
  return 'questions' in item && Array.isArray(item.questions);
};

const isDirectionalFlatQuestion = (item: LiveQuestionItem) => {
  if (isDirectionalQuestionSet(item)) return false;
  return Boolean(
    item.type?.toLowerCase().includes('direction') ||
    item.setId ||
    item.directionId ||
    item.directionText
  );
};

const getDirectionalGroupKey = (item: LiveQuestion) => {
  return String(item.setId || item.directionId || item.directionText || item.id);
};

const toDirectionSet = (questions: LiveQuestion[]) => {
  const [first] = questions;
  const sortedQuestions = [...questions].sort((a, b) => {
    const aIndex = typeof a.directionQuestionNumber === 'number' ? a.directionQuestionNumber : Number.MAX_SAFE_INTEGER;
    const bIndex = typeof b.directionQuestionNumber === 'number' ? b.directionQuestionNumber : Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return String(a.id).localeCompare(String(b.id));
  });

  return {
    directionId: String(first.directionId || first.setId || first.id),
    directionText: String(first.directionText || ''),
    setType: first.setType,
    image: first.image,
    imageUrl: first.imageUrl,
    questions: sortedQuestions.map((question) => {
      const { setId, directionId, directionText, directionQuestionNumber, setType, ...rest } = question;
      return rest;
    }),
  } satisfies LiveDirectionSet;
};

export const normalizeSectionQuestionItems = (items: LiveQuestionItem[]) => {
  const normalQuestions: LiveQuestionItem[] = [];
  const directionalSetItems: LiveDirectionSet[] = [];
  const directionalGroups = new Map<string, LiveQuestion[]>();
  const groupOrder: string[] = [];

  for (const item of items ?? []) {
    if (isDirectionalQuestionSet(item)) {
      directionalSetItems.push(item);
      continue;
    }

    if (!isDirectionalFlatQuestion(item)) {
      normalQuestions.push(item);
      continue;
    }

    const groupKey = getDirectionalGroupKey(item);
    if (!directionalGroups.has(groupKey)) {
      directionalGroups.set(groupKey, []);
      groupOrder.push(groupKey);
    }
    directionalGroups.get(groupKey)!.push(item);
  }

  const groupedDirectionalSets = groupOrder
    .map((groupKey) => directionalGroups.get(groupKey)!)
    .filter((group) => group.length > 0)
    .map((group) => toDirectionSet(group));

  return [...normalQuestions, ...directionalSetItems, ...groupedDirectionalSets];
};

export const normalizeMockPayload = (payload: LiveMockPayload): LiveMockPayload => {
  return {
    ...payload,
    sections: (payload.sections ?? []).map((section) => {
      const normalizedQuestions = normalizeSectionQuestionItems(section.questions ?? []);
      return {
        ...section,
        questions: normalizedQuestions,
        totalQuestions: countSectionQuestions({ ...section, questions: normalizedQuestions }),
      };
    }),
  };
};

export const countSectionQuestions = (section: LiveSection) => {
  return normalizeSectionQuestionItems(section.questions ?? []).reduce((sum, item) => {
    if (isDirectionalQuestionSet(item)) {
      return sum + (item.questions?.length ?? 0);
    }
    return sum + 1;
  }, 0);
};

export const flattenSectionQuestions = (section: LiveSection, globalOffset = 0): FlattenedLiveQuestion[] => {
  const sectionName = normalizeSubject(section.name);
  const flattened: FlattenedLiveQuestion[] = [];
  let sectionQuestionIndex = 0;

  for (const item of normalizeSectionQuestionItems(section.questions ?? [])) {
    if (isDirectionalQuestionSet(item)) {
      const directionImageUrl = getImageUrl(item.image, item.imageUrl) ?? undefined;
      for (const question of item.questions ?? []) {
        flattened.push({
          ...question,
          sectionId: section.sectionId,
          sectionName,
          questionIndex: sectionQuestionIndex,
          globalIndex: globalOffset + sectionQuestionIndex,
          answerKey: `${sectionName}::${sectionQuestionIndex}`,
          direction: {
            directionId: item.directionId,
            directionText: item.directionText,
            setType: item.setType,
            imageUrl: directionImageUrl,
          },
        });
        sectionQuestionIndex += 1;
      }
      continue;
    }

    const question = item as LiveQuestion;
    flattened.push({
      ...question,
      sectionId: section.sectionId,
      sectionName,
      questionIndex: sectionQuestionIndex,
      globalIndex: globalOffset + sectionQuestionIndex,
      answerKey: `${sectionName}::${sectionQuestionIndex}`,
    });
    sectionQuestionIndex += 1;
  }

  return flattened;
};
