/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { flattenSectionsWithAnnotations } from './db';
import type { Annotation, AuditSection } from './types';

describe('flattenSectionsWithAnnotations', () => {
  it('strips nested annotations from section rows and flattens them', () => {
    const annotation = {
      id: 'ann-1',
      audit_section_id: 'sec-1',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      text: 'Note',
      created_at: '2026-01-01',
    } as Annotation;

    const section = {
      id: 'sec-1',
      audit_id: 'audit-1',
      section_key: 'flows',
      status: 'approved',
      annotations: [annotation],
    } as AuditSection & { annotations: Annotation[] };

    const { sections, annotations } = flattenSectionsWithAnnotations([section]);

    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('sec-1');
    expect('annotations' in sections[0]).toBe(false);
    expect(annotations).toEqual([annotation]);
  });
});
