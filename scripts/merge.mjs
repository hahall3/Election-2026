import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

async function mergeShards() {
  const artifactDir = 'shard-artifacts';
  let allRaces = [];
  let totalFailed = 0;
  let day = '2026-11-03';

  // Find all races-*.json files inside the downloaded artifact folders
  const files = [];
  async function findFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await findFiles(fullPath);
      } else if (entry.name.startsWith('races-') && entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
  }

  await findFiles(artifactDir);

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    if (data.day) day = data.day;
    if (data.failed) totalFailed += data.failed;
    if (Array.isArray(data.races)) {
      allRaces.push(...data.races);
    }
  }

  // Deduplicate and sort races by ID
  const map = new Map();
  for (const race of allRaces) {
    map.set(race.id, race);
  }
  const mergedRaces = Array.from(map.values()).sort((a, b) => a.id - b.id);

  await mkdir('data', { recursive: true });
  await writeFile(
    'data/races.json',
    JSON.stringify(
      {
        updated: new Date().toISOString(),
        day,
        state: 'KY',
        failed: totalFailed,
        races: mergedRaces
      },
      null,
      2
    )
  );

  console.log(`Successfully merged ${mergedRaces.length} races into data/races.json`);
}

mergeShards().catch((err) => {
  console.error('Failed to merge shards:', err);
  process.exit(1);
});
