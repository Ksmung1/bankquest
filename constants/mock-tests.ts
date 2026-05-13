export type MockTest = {
  id: string;
  title: string;
  exam: 'SBI PO' | 'IBPS PO' | 'RRB PO' | 'SBI Clerk';
  mode: 'Prelims' | 'Mains';
  subject: 'English Language' | 'Quantitative Aptitude' | 'Reasoning';
  questions: number;
  durationMins: number;
};

export const mockTests: MockTest[] = [
  { id: 'sbi-po-prelims-01', title: 'SBI PO Prelims Mock #1', exam: 'SBI PO', mode: 'Prelims', subject: 'Quantitative Aptitude', questions: 30, durationMins: 20 },
  { id: 'sbi-po-prelims-04', title: 'SBI PO Prelims Mock #4', exam: 'SBI PO', mode: 'Prelims', subject: 'Quantitative Aptitude', questions: 30, durationMins: 20 },
  { id: 'ibps-po-prelims-02', title: 'IBPS PO Prelims Mock #2', exam: 'IBPS PO', mode: 'Prelims', subject: 'Reasoning', questions: 35, durationMins: 20 },
  { id: 'ibps-po-mains-01', title: 'IBPS PO Mains Mock #1', exam: 'IBPS PO', mode: 'Mains', subject: 'English Language', questions: 40, durationMins: 30 },
  { id: 'rrb-po-prelims-03', title: 'RRB PO Prelims Mock #3', exam: 'RRB PO', mode: 'Prelims', subject: 'Reasoning', questions: 40, durationMins: 25 },
  { id: 'sbi-clerk-prelims-05', title: 'SBI Clerk Prelims Mock #5', exam: 'SBI Clerk', mode: 'Prelims', subject: 'English Language', questions: 30, durationMins: 20 },
];

export const examFilters = ['All', 'SBI PO', 'IBPS PO', 'RRB PO', 'SBI Clerk'] as const;

export type ExamFilter = (typeof examFilters)[number];
