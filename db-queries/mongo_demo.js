// MongoDB demo queries (original report rows + unmatched rows)
// Run (PowerShell, in the project folder):
//   docker cp db-queries\mongo_demo.js mrms-mongo:/tmp/mongo_demo.js
//   docker exec mrms-mongo mongosh --quiet -u royalty -p royalty_pw --authenticationDatabase admin royalty_reports /tmp/mongo_demo.js

print('================ COLLECTIONS ================');
printjson(db.getCollectionNames());

print('\n================ DOCUMENT COUNTS ================');
print('streaming_reports (one document per CSV line):', db.streaming_reports.countDocuments());
print('unmatched_reports:', db.unmatched_reports.countDocuments());

print('\n================ ROWS PER REPORT AND STATUS ================');
db.streaming_reports.aggregate([
  { $group: { _id: { report: '$report_key', status: '$status' }, rows: { $sum: 1 } } },
  { $sort: { '_id.report': 1 } },
]).forEach((r) => print(`${r._id.report.padEnd(24)} ${r._id.status.padEnd(10)} ${r.rows}`));

print('\n================ ONE ORIGINAL ROW (exactly as received in the CSV) ================');
printjson(db.streaming_reports.findOne({ report_key: 'SPOTIFY-2026-10' }, { _id: 0 }));

print('\n================ ALL ORIGINAL ROWS OF THE YOUTUBE REPORT ================');
db.streaming_reports.find({ report_key: 'YOUTUBE_MUSIC-2026-10' }, { _id: 0, source_row_id: 1, status: 1, original_row: 1 })
  .sort({ row_number: 1 }).forEach((d) => printjson(d));

print('\n================ UNMATCHED / MANUALLY MAPPED ROWS ================');
db.unmatched_reports.find({}, { _id: 0, source_row_id: 1, isrc: 1, track_name: 1, revenue: 1, status: 1, mapped_track_title: 1, mapped_by: 1, pg_record_id: 1 })
  .forEach((d) => printjson(d));

print('\n================ INDEXES (unique source_row_id prevents duplicate rows) ================');
printjson(db.streaming_reports.getIndexes().map((i) => ({ name: i.name, key: i.key, unique: !!i.unique })));
