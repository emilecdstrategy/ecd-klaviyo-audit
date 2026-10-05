import { describe, expect, it } from 'vitest';
import { xeroErrorMessage } from './xero';

describe('xeroErrorMessage', () => {
  it('turns a raw 403 into what to do, keeping the raw text as detail', () => {
    // As stored on a proposal on Oct 5.
    const raw = 'xero_api_403: {"Type":null,"Title":"Forbidden","Status":403,"Detail":"AuthenticationUnsuccessful","Instance":"fb2d28d41-48e8-8da4-33bac96d03a4","Extensions":{}}';
    const out = xeroErrorMessage(raw);
    expect(out.message).toMatch(/Reconnect Xero under Settings > API Connection/);
    expect(out.message).not.toMatch(/xero_api|Forbidden|\{/);
    expect(out.detail).toBe(raw);
  });

  it("uses Xero's own validation message on a 400", () => {
    const raw = 'xero_api_400: {"Elements":[{"ValidationErrors":[{"Message":"Account code \'200\' is not a valid code for this document."}]}]}';
    expect(xeroErrorMessage(raw).message).toBe("Xero rejected the invoice: Account code '200' is not a valid code for this document.");
  });

  it('explains the setup states and passes readable text through', () => {
    expect(xeroErrorMessage('xero_not_connected').message).toMatch(/isn't connected/);
    expect(xeroErrorMessage('xero_token_400: {"error":"invalid_grant"}').message).toMatch(/expired/);
    expect(xeroErrorMessage('fully_discounted').message).toMatch(/nothing to invoice/);
    const human = 'No Xero account is set for Klaviyo Retainer. Map it under Settings.';
    expect(xeroErrorMessage(human)).toEqual({ message: human, detail: null });
  });
});
