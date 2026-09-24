/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { formatAnswers, questionItems } from './agent-questions';

const yesNo = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
];

describe('agent questions', () => {
  it('treats a payload without a questions list as one question', () => {
    expect(questionItems({ question: 'SEO?', options: yesNo })).toHaveLength(1);
  });

  it('walks the questions list when several were asked', () => {
    const items = questionItems({
      question: 'SEO?',
      options: yesNo,
      questions: [
        { question: 'SEO?', options: yesNo },
        { question: 'Phone orders?', options: yesNo },
      ],
    });
    expect(items.map(q => q.question)).toEqual(['SEO?', 'Phone orders?']);
  });

  it('sends every answer back numbered under its question', () => {
    const items = [
      { question: 'Exclude dedicated SEO?', options: yesNo },
      { question: 'Keep phone orders?', options: yesNo },
    ];
    expect(formatAnswers(items, ['Yes', 'Out of scope'])).toBe(
      '1. Exclude dedicated SEO?\nYes\n\n2. Keep phone orders?\nOut of scope',
    );
  });
});
