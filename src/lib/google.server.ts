/** Customer-owned Google OAuth refresh credentials stay server-side. */
export async function googleConnection(kind: 'drive' | 'sheets') {
  if (process.env['CUSTOM_BACKEND_URL']) {
    const clientId = process.env['CUSTOM_GOOGLE_CLIENT_ID'];
    const clientSecret = process.env['CUSTOM_GOOGLE_CLIENT_SECRET'];
    const refreshToken = process.env['CUSTOM_GOOGLE_REFRESH_TOKEN'];
    if (!clientId || !clientSecret || !refreshToken) throw new Error('Google সংযোগের নিজস্ব অনুমতি সেটআপ করুন।');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    });
    const data = await response.json() as { access_token?: string };
    if (!response.ok || !data.access_token) throw new Error('Google অনুমতি নবায়ন হয়নি। ক্রেতার Google সংযোগ আবার সেটআপ করুন।');
    return { base: kind === 'drive' ? 'https://www.googleapis.com/drive/v3' : 'https://sheets.googleapis.com/v4', headers: { Authorization: `Bearer ${data.access_token}`, 'Content-Type': 'application/json' } as Record<string, string> };
  }
  const key = process.env['LOVABLE_API_KEY'];
  const connection = process.env[kind === 'drive' ? 'GOOGLE_DRIVE_API_KEY' : 'GOOGLE_SHEETS_API_KEY'];
  if (!key || !connection) throw new Error('Google সংযুক্ত নয়।');
  return { base: `https://connector-gateway.lovable.dev/${kind === 'drive' ? 'google_drive/drive/v3' : 'google_sheets/v4'}`, headers: { Authorization: `Bearer ${key}`, 'X-Connection-Api-Key': connection, 'Content-Type': 'application/json' } as Record<string, string> };
}
