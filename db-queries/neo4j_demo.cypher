// Neo4j demo queries (sampling graph).
// Easiest: paste ONE query at a time into Neo4j Browser at http://localhost:7475
// Terminal (PowerShell, in the project folder):
//   cmd /c "type db-queries\neo4j_demo.cypher | docker exec -i mrms-neo4j cypher-shell -u neo4j -p royalty_neo4j_pw 2>&1"

// 1. All Track nodes (mirrored from PostgreSQL; pgId = tracks.id)
MATCH (t:Track) RETURN t.pgId AS pgId, t.title AS title, t.isrc AS isrc ORDER BY pgId;

// 2. SAMPLES relationships with their royalty percentage (basis points)
MATCH (s:Track)-[r:SAMPLES]->(t:Track)
RETURN s.title AS source_track, t.title AS sampled_track, r.percentageBp AS percentage_bp,
       toString(r.percentageBp / 100.0) + '%' AS percent, r.createdBy AS created_by;

// 3. Graph view (in Neo4j Browser this draws the nodes and arrows)
MATCH (t:Track) OPTIONAL MATCH p = (t)-[:SAMPLES]->() RETURN t, p;

// 4. How much each track owes / is owed
MATCH (t:Track)
OPTIONAL MATCH (t)-[o:SAMPLES]->()
OPTIONAL MATCH ()-[i:SAMPLES]->(t)
RETURN t.title AS track, coalesce(sum(DISTINCT o.percentageBp), 0) AS owes_bp, count(DISTINCT i) AS sampled_by_count;

// 5. Constraint that keeps Track.pgId unique
SHOW CONSTRAINTS YIELD name, labelsOrTypes, properties, type;
