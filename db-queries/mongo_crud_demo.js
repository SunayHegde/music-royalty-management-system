// MongoDB CRUD demo on the unmatched_reports collection (Create, Read, Update, Delete).
// Uses a temporary document, so the real report rows are left untouched.
// Run (PowerShell, in the project folder):
//   docker cp db-queries\mongo_crud_demo.js mrms-mongo:/tmp/mongo_crud_demo.js
//   docker exec mrms-mongo mongosh --quiet -u royalty -p royalty_pw --authenticationDatabase admin royalty_reports /tmp/mongo_crud_demo.js

const id = 'DEMO-2026-10:99';

print('---------------- CREATE: insertOne ----------------');
printjson(db.unmatched_reports.insertOne({
  source_row_id: id, report_key: 'DEMO-2026-10', platform: 'SPOTIFY', month: '2026-10', row_number: 99,
  original_row: { ISRC: 'XX123', track_name: 'Demo Song', streams: '50', revenue: '12.50', month: '2026-10' },
  isrc: 'XX123', track_name: 'Demo Song', streams: 50, revenue: '12.50',
  reason: 'ISRC not found in catalogue', status: 'UNMATCHED', created_at: new Date(),
}));

print('\n---------------- READ: find with filter + projection ----------------');
db.unmatched_reports.find({ status: 'UNMATCHED' }, { _id: 0, source_row_id: 1, isrc: 1, track_name: 1, revenue: 1, status: 1 })
  .forEach((d) => printjson(d));

print('\n---------------- UPDATE: updateOne with $set ----------------');
printjson(db.unmatched_reports.updateOne(
  { source_row_id: id, status: 'UNMATCHED' },
  { $set: { status: 'MAPPED', mapped_track_title: 'Summer Nights', mapped_by: 'admin', mapped_at: new Date() } }
));
printjson(db.unmatched_reports.findOne({ source_row_id: id }, { _id: 0, source_row_id: 1, status: 1, mapped_track_title: 1, mapped_by: 1 }));

print('\n---------------- duplicate insert is blocked by the unique index ----------------');
try {
  db.unmatched_reports.insertOne({ source_row_id: id, status: 'UNMATCHED' });
} catch (e) { print('E11000 duplicate key -> ' + e.message.split(' dup key')[0]); }

print('\n---------------- DELETE: deleteOne ----------------');
printjson(db.unmatched_reports.deleteOne({ source_row_id: id }));
print('documents left with that id: ' + db.unmatched_reports.countDocuments({ source_row_id: id }));

print('\n---------------- AGGREGATE: revenue per platform from the original rows ----------------');
db.streaming_reports.aggregate([
  { $group: { _id: '$platform', rows: { $sum: 1 }, revenue: { $sum: { $toDecimal: '$original_row.revenue' } } } },
  { $sort: { _id: 1 } },
]).forEach((r) => print(`${r._id.padEnd(14)} rows=${r.rows}  revenue=${r.revenue}`));
