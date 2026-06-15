import { ensureTable, countDocuments } from '../lib/bigquery_store.js';
try {
  console.log('Testing BigQuery connection...');
  const table = await ensureTable();
  console.log('✅ BigQuery connected! Table:', table?.id || 'exists');
  const count = await countDocuments();
  console.log('📊 Documents in table:', count);
} catch (err) {
  console.log('❌ Error:', err.message?.slice(0, 300));
}
