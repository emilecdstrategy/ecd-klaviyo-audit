import { supabase } from './supabase';

export type XeroStatus = {
  connected: boolean;
  /** False until XERO_CLIENT_ID / XERO_CLIENT_SECRET are configured. */
  credentials_configured: boolean;
  tenant_name: string | null;
  sales_account_code: string | null;
  tax_type: string | null;
  last_refreshed_at: string | null;
  last_error: string | null;
  /** Shown in Settings so it can be pasted into the Xero app config verbatim. */
  redirect_uri: string;
};

export type XeroAccount = { code: string; name: string; taxType: string };

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<any>('xero_admin', { body });
  if (error) throw new Error(error.message);
  if (data?.ok !== true) throw new Error(data?.error?.message ?? 'The Xero request failed');
  return data as T;
}

export function getXeroStatus(): Promise<XeroStatus & { ok: true }> {
  return call<XeroStatus & { ok: true }>({ action: 'status' });
}

/** Returns the Xero consent URL to send the admin to. */
export async function startXeroConnect(): Promise<string> {
  const { url } = await call<{ url: string }>({ action: 'connect' });
  return url;
}

export async function listXeroRevenueAccounts(): Promise<XeroAccount[]> {
  const { accounts } = await call<{ accounts: XeroAccount[] }>({ action: 'accounts' });
  return accounts;
}

export function saveXeroSettings(input: { account_code?: string; tax_type?: string }): Promise<unknown> {
  return call({ action: 'save_settings', ...input });
}

export function disconnectXero(): Promise<unknown> {
  return call({ action: 'disconnect' });
}

/** Retry the draft invoice for one proposal (after a failure, or manually). */
export async function createXeroDraftInvoice(proposalId: string): Promise<{ invoice_id: string; invoice_number: string }> {
  const { data, error } = await supabase.functions.invoke<any>('xero_create_invoice', {
    body: { proposal_id: proposalId },
  });
  if (error) throw new Error(error.message);
  if (data?.ok !== true) throw new Error(data?.error?.message ?? 'Could not create the Xero invoice');
  return { invoice_id: data.invoice_id, invoice_number: data.invoice_number };
}

/** Deep link to an invoice in Xero. */
export function xeroInvoiceUrl(invoiceId: string): string {
  return `https://go.xero.com/app/invoicing/edit/${invoiceId}`;
}
