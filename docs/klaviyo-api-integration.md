# Klaviyo API integration (Full automation)

This app’s “API audit” mode is designed to fetch real Klaviyo account configuration + performance and persist a normalized snapshot to Supabase for AI + reporting.

## Authentication + versioning

- **Auth**: `Authorization: Klaviyo-API-Key <private_key>` ([docs](https://developers.klaviyo.com/en/docs/authenticate_))
- **Revision**: `revision: YYYY-MM-DD` is required for `/api` requests ([docs](https://developers.klaviyo.com/en/docs/api_versioning_and_deprecation_policy))

## Minimum required scopes (private key)

Klaviyo private key should include at least:

- `accounts:read`
- `lists:read`
- `segments:read`
- `flows:read`
- `forms:read`
- `campaigns:read`

Reference: scope list in Klaviyo auth docs ([docs](https://developers.klaviyo.com/en/docs/authenticate_)).

## Endpoints we rely on

### Identity / key validation

- `GET /api/accounts` (`accounts:read`) ([Get Accounts](https://developers.klaviyo.com/en/reference/get_accounts))

### Objects (configuration snapshot)

- `GET /api/flows` (`flows:read`) ([Get Flows](https://developers.klaviyo.com/en/reference/get_flows))
- `GET /api/campaigns` (`campaigns:read`) ([Get Campaigns](https://developers.klaviyo.com/en/reference/get_campaigns))
  - Note: **campaign listing requires a channel filter**, e.g. `filter=equals(messages.channel,'email')`.
- `GET /api/lists` (`lists:read`) ([Get Lists](https://developers.klaviyo.com/en/reference/get_lists))
- `GET /api/segments` (`segments:read`) ([Get Segments](https://developers.klaviyo.com/en/reference/get_segments))
- `GET /api/forms` (`forms:read`) ([Get Forms](https://developers.klaviyo.com/en/reference/get_forms))

### Performance (Reporting API)

We use “values reports” to pull UI-matching performance. Reporting overview: ([docs](https://apidocs.klaviyo.com/en/reference/reporting_api_overview))

- Campaign values report:
  - `POST /api/campaign-values-reports` (`campaigns:read`) ([Query Campaign Values](https://developers.klaviyo.com/en/reference/query_campaign_values))
- Flow values report:
  - `POST /api/flow-values-reports` (`flows:read`) ([Query Flow Values](https://developers.klaviyo.com/en/reference/query_flow_values))

Notes:
- Values report rate limits can be low; we batch and cache where possible.
- Performance in Klaviyo UI is calculated by **send date**, which is why we prefer the Reporting API vs Metric Aggregates.

## Data storage + safety

- Private keys must **never** be stored in plaintext in `clients` or in frontend storage.
- Keys are stored encrypted in `client_secrets` and only decrypted server-side inside Edge Functions.
- Never log keys; all errors should redact secrets.

