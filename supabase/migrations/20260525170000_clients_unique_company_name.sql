/*
  Prevent duplicate client rows for the same company name (case/whitespace insensitive).
*/

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_company_name_normalized
  ON clients (lower(trim(company_name)))
  WHERE trim(company_name) <> '';
