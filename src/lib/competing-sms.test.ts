/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { isKlaviyoSmsInactive, scanHtmlForCompetingSms } from './competing-sms-detect';
import {
  buildCompetingSmsKeyFinding,
  extractRecoveryFlowRevenue,
  injectCompetingSmsFinding,
} from './competing-sms-finding';

describe('competing-sms', () => {
  it('detects Postscript and Attentive script markers in HTML', () => {
    const html = `
      <script src="https://sdk.postscript.io/sdk.bundle.js?shopId=123"></script>
      <iframe src="https://cdn.attn.tv/xyz"></iframe>
    `;
    const found = scanHtmlForCompetingSms(html);
    expect(found.map((p) => p.id)).toContain('postscript');
    expect(found.map((p) => p.id)).toContain('attentive');
  });

  it('treats Klaviyo SMS as inactive when revenue and subscribers are negligible', () => {
    expect(
      isKlaviyoSmsInactive({
        sms_revenue_30d: 0,
        sms_subscribed_profiles: 0,
        has_live_sms_named_flow: false,
      }),
    ).toBe(true);
    expect(
      isKlaviyoSmsInactive({
        sms_revenue_30d: 120,
        sms_subscribed_profiles: 0,
        has_live_sms_named_flow: false,
      }),
    ).toBe(false);
  });

  it('builds a key finding with browse/cart revenue context', () => {
    const recovery = extractRecoveryFlowRevenue([
      { flow_name: 'Browse Abandonment', monthly_revenue_current: 5034 },
      { flow_name: 'Abandoned Cart', monthly_revenue_current: 12000 },
    ]);
    const text = buildCompetingSmsKeyFinding(
      [{ id: 'postscript', name: 'Postscript', markers: ['sdk.postscript.io'] }],
      recovery,
    );
    expect(text).toContain('Postscript');
    expect(text).toContain('Browse Abandonment');
    expect(text).toContain('Cart Abandonment');
    expect(text.length).toBeLessThanOrEqual(500);
  });

  it('injectCompetingSmsFinding replaces the fifth slot when full', () => {
    const base = ['a', 'b', 'c', 'd', 'e'];
    const next = injectCompetingSmsFinding(base, '**Postscript SMS is on your site but Klaviyo SMS is not**');
    expect(next).toHaveLength(5);
    expect(next[4]).toContain('Postscript');
    expect(next[0]).toBe('a');
  });
});
