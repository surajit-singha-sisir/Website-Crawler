const { initDb, getDb } = require('./database');
initDb().then(() => {
  const db = getDb();
  const row = db.prepare('SELECT 1 as ok').get();
  console.log('DB OK, row:', JSON.stringify(row));
  process.exit(0);
}).catch(e => {
  console.error('FAIL', e.message);
  process.exit(1);
});
