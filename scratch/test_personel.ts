import fs from 'fs';

const code = fs.readFileSync('server.ts', 'utf-8');

const newEndpoint = `
// --- TEMPORARY ENDPOINT FOR PERSONEL ---
app.post('/api/mikro/test-personel', async (req, res) => {
  try {
    const { mikroSql } = require('./src/services/mikroSql');
    const result = await mikroSql("SELECT TOP 5 * FROM PERSONEL_TANIMLARI");
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
// --- END TEMPORARY ---
`;

if (!code.includes('/api/mikro/test-personel')) {
  fs.writeFileSync('server.ts', code.replace("app.post('/api/mikro/pull/bakiye'", newEndpoint + "\napp.post('/api/mikro/pull/bakiye'"));
}
