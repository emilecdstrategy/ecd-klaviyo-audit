import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Local-only sign-in for verifying UI work against real data.
 *
 * The app authenticates by emailed magic link, which nothing automated can
 * complete, so changes behind the login could only ever be checked by hand.
 * This mints a normal session for one configured account instead.
 *
 * It is safe in the ways that matter:
 *  - `apply: 'serve'` means the plugin is part of the dev server only. It is
 *    absent from `npm run build`, so nothing reaches production.
 *  - The service role key is read and used HERE, in the Node process. It is
 *    never sent to the browser and never enters the client bundle.
 *  - Requests must come from loopback, so nothing on the network can call it.
 *  - No password exists anywhere: the admin API issues a one-time magic-link
 *    token which is immediately exchanged for a session.
 *  - The account it signs in as should have a role that is neither admin nor
 *    auditor, which the row-level security policies make read-only.
 */

function readEnvFiles(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of ['.env', '.env.supabase', '.env.local']) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && value && !(key in out)) out[key] = value;
    }
  }
  return out;
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const host = address.replace(/^::ffff:/, '');
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

export function devLoginPlugin(): Plugin {
  return {
    name: 'ecd-dev-login',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev_login', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };

        if (!isLoopback(req.socket.remoteAddress)) return send(403, { error: 'Loopback only' });

        const env = readEnvFiles(server.config.root);
        const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
        const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.AUDIT_SUPABASE_SERVICE_ROLE_KEY;
        const email = env.DEV_LOGIN_EMAIL;

        if (!url || !serviceKey) return send(500, { error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from the local env files' });
        if (!email) {
          return send(400, {
            error:
              'DEV_LOGIN_EMAIL is not set. Add it to .env.supabase, pointing at a profile whose role is neither admin nor auditor so the session is read-only.',
          });
        }

        try {
          // A one-time magic-link token, issued without sending any email.
          const linkRes = await fetch(`${url}/auth/v1/admin/generate_link`, {
            method: 'POST',
            headers: {
              apikey: serviceKey,
              authorization: `Bearer ${serviceKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ type: 'magiclink', email }),
          });
          const link = await linkRes.json();
          if (!linkRes.ok) return send(linkRes.status, { error: link?.msg || link?.error_description || 'Could not generate a link' });
          const token = link?.hashed_token ?? link?.properties?.hashed_token;
          if (!token) return send(500, { error: 'The admin API returned no token' });

          // Exchange it for a session, exactly as clicking the emailed link would.
          const verifyRes = await fetch(`${url}/auth/v1/verify`, {
            method: 'POST',
            headers: { apikey: serviceKey, 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'magiclink', token, email }),
          });
          const session = await verifyRes.json();
          if (!verifyRes.ok || !session?.access_token) {
            return send(verifyRes.status || 500, { error: session?.msg || session?.error_description || 'Could not verify the token' });
          }
          return send(200, {
            email,
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          });
        } catch (e) {
          return send(500, { error: e instanceof Error ? e.message : 'Dev sign-in failed' });
        }
      });
    },
  };
}
