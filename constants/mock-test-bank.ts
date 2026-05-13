export type SubjectTab = 'English Language' | 'Quantitative Aptitude' | 'Reasoning';
export type OptionKey = 'A' | 'B' | 'C' | 'D';

export type MockQuestion = {
  id: number;
  text: string;
  plus: string;
  minus: string;
  correct: OptionKey;
  options: { key: OptionKey; text: string }[];
  explanation: string;
  keyPoints: string[];
};

export type SubjectQuestionMap = Record<SubjectTab, MockQuestion[]>;

export const SUBJECTS: SubjectTab[] = ['English Language', 'Quantitative Aptitude', 'Reasoning'];

export const QUESTIONS: SubjectQuestionMap = {
  'English Language': [
    {
      id: 1,
      text: 'Q1: Choose the correct synonym for "abundant".',
      plus: '+1 Mark',
      minus: '-0.25 Mark',
      correct: 'B',
      options: [
        { key: 'A', text: 'Scarce' },
        { key: 'B', text: 'Plentiful' },
        { key: 'C', text: 'Distant' },
        { key: 'D', text: 'Rigid' },
      ],
      explanation: 'Abundant means available in large quantity.',
      keyPoints: ['Synonym mapping', 'Eliminate opposites first'],
    },
    {
      id: 2,
      text: 'Q2: Fill in the blank: She has been working here ___ 2019.',
      plus: '+1 Mark',
      minus: '-0.25 Mark',
      correct: 'B',
      options: [
        { key: 'A', text: 'for' },
        { key: 'B', text: 'since' },
        { key: 'C', text: 'from' },
        { key: 'D', text: 'by' },
      ],
      explanation: 'Since is used with a point in time (2019).',
      keyPoints: ['Since vs For', 'Point in time rule'],
    },
    {
      id: 3,
      text: 'Q3: Identify the grammatically correct sentence.',
      plus: '+1 Mark',
      minus: '-0.25 Mark',
      correct: 'C',
      options: [
        { key: 'A', text: 'He do not like tea.' },
        { key: 'B', text: 'He does not likes tea.' },
        { key: 'C', text: 'He does not like tea.' },
        { key: 'D', text: 'He not likes tea.' },
      ],
      explanation: 'With does, main verb remains base form: like.',
      keyPoints: ['Subject-verb agreement', 'Do/does + base verb'],
    },
  ],
  'Quantitative Aptitude': [
    {
      id: 4,
      text: 'Q4: A train at 60 km/h covers 240 km in how many hours?',
      plus: '+1 Mark',
      minus: '-0.25 Mark',
      correct: 'C',
      options: [
        { key: 'A', text: '2 hours' },
        { key: 'B', text: '3 hours' },
        { key: 'C', text: '4 hours' },
        { key: 'D', text: '5 hours' },
      ],
      explanation: 'Time = Distance / Speed = 240 / 60 = 4 hours.',
      keyPoints: ['Core formula: T=D/S', 'Unit consistency'],
    },
    {
      id: 5,
      text: 'Q5: If SI on Rs. 2000 for 3 years is Rs. 300, find the annual rate.',
      plus: '+1 Mark',
      minus: '-0.25 Mark',
      correct: 'B',
      options: [
        { key: 'A', text: '4%' },
        { key: 'B', text: '5%' },
        { key: 'C', text: '6%' },
        { key: 'D', text: '7%' },
      ],
      explanation: 'SI = (P*R*T)/100 => 300 = (2000*R*3)/100 => R=5%.',
      keyPoints: ['Simple interest formula', 'Algebraic isolation of R'],
    },
    {
      id: 6,
      text: 'Q6: A pipe fills a tank in 4h and another empties in 6h. Together?',
      plus: '+1 Mark',
      minus: '-0.25 Mark',
      correct: 'C',
      options: [
        { key: 'A', text: '8 hours' },
        { key: 'B', text: '10 hours' },
        { key: 'C', text: '12 hours' },
        { key: 'D', text: '14 hours' },
      ],
      explanation: 'Net rate = 1/4 - 1/6 = 1/12 tank per hour.',
      keyPoints: ['Work-rate addition/subtraction', 'Find reciprocal of net rate'],
    },
  ],
  Reasoning: [
    {
      id: 7,
      text: 'Q7: In a certain code, CAT is coded as DBU. DOG is coded as?',
      plus: '+1 Mark',
      minus: '-0.25 Mark',
      correct: 'A',
      options: [
        { key: 'A', text: 'EPH' },
        { key: 'B', text: 'EOH' },
        { key: 'C', text: 'DPH' },
        { key: 'D', text: 'EOG' },
      ],
      explanation: 'Each letter shifts by +1: D->E, O->P, G->H.',
      keyPoints: ['Letter shift pattern', 'Apply same transform consistently'],
    },
    {
      id: 8,
      text: 'Q8: Find the odd one out: 2, 6, 12, 20, 30, 42, 54',
      plus: '+1 Mark',
      minus: '-0.25 Mark',
      correct: 'D',
      options: [
        { key: 'A', text: '20' },
        { key: 'B', text: '30' },
        { key: 'C', text: '42' },
        { key: 'D', text: '54' },
      ],
      explanation: 'Pattern n(n+1): 1*2,2*3,...6*7=42; next should be 56, not 54.',
      keyPoints: ['Sequence recognition', 'Check generated next term'],
    },
    {
      id: 9,
      text: 'Q9: If all roses are flowers and some flowers are red, then:',
      plus: '+1 Mark',
      minus: '-0.25 Mark',
      correct: 'B',
      options: [
        { key: 'A', text: 'All roses are red' },
        { key: 'B', text: 'Some roses may be red' },
        { key: 'C', text: 'No rose is red' },
        { key: 'D', text: 'None follows' },
      ],
      explanation: 'No definite link forces all roses red, but overlap is possible.',
      keyPoints: ['Syllogism possibility', 'Avoid definite overreach'],
    },
  ],
};

export const questionKey = (subject: SubjectTab, index: number) => `${subject}::${index}`;

export const totalQuestionsCount = SUBJECTS.reduce((sum, s) => sum + QUESTIONS[s].length, 0);
