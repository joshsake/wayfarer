// One-shot: dumps the live destinations table as INSERT statements for the
// retroactive baseline migration. Run: node --env-file=.env.local scripts/generate-baseline-seed.mjs
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const res = await fetch(`${url}/rest/v1/destinations?select=*&order=id`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const rows = await res.json();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const cols = [
  "id", "name", "country", "tagline", "emoji", "local_culture",
  "classic_sights", "hotel_quality", "food_scene", "experiences",
  "transit_quality", "family_friendly", "walkability", "daily_cost", "highlights",
];
for (const row of rows) {
  const vals = cols.map((c) =>
    c === "highlights"
      ? `array[${row[c].map(q).join(", ")}]`
      : typeof row[c] === "number" ? row[c] : q(row[c]),
  );
  console.log(`insert into public.destinations (${cols.join(", ")})\nvalues (${vals.join(", ")})\non conflict (id) do nothing;\n`);
}
