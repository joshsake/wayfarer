-- ---------------------------------------------------------------------------
-- RETROACTIVE BASELINE. This schema was originally applied via the Supabase
-- dashboard on 2026-07-20 and never committed — this file reconstructs it so
-- the README's claim ("the database is reproducible from migrations") is
-- actually true. Idempotent by design: safe to run against the live project
-- (IF NOT EXISTS / ON CONFLICT DO NOTHING throughout).
-- ---------------------------------------------------------------------------

create table if not exists public.destinations (
  id text primary key,
  name text not null,
  country text not null,
  tagline text not null,
  emoji text not null,
  local_culture integer not null check (local_culture between 0 and 100),
  classic_sights integer not null check (classic_sights between 0 and 100),
  hotel_quality integer not null check (hotel_quality between 0 and 100),
  food_scene integer not null check (food_scene between 0 and 100),
  experiences integer not null check (experiences between 0 and 100),
  transit_quality integer not null check (transit_quality between 0 and 100),
  family_friendly integer not null check (family_friendly between 0 and 100),
  walkability integer not null check (walkability between 0 and 100),
  daily_cost integer not null,
  highlights text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.destinations enable row level security;

-- Guarded by "any SELECT policy exists", not by policy name — the original
-- was created in the dashboard and its exact name isn't recorded anywhere.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'destinations' and cmd = 'SELECT'
  ) then
    create policy "public read" on public.destinations for select using (true);
  end if;
end $$;

-- Seed (generated from the live table by scripts/generate-baseline-seed.mjs):
insert into public.destinations (id, name, country, tagline, emoji, local_culture, classic_sights, hotel_quality, food_scene, experiences, transit_quality, family_friendly, walkability, daily_cost, highlights)
values ('copenhagen', 'Copenhagen', 'Denmark', 'Design hotels, bike lanes, and effortless family days', '🚲', 80, 65, 90, 88, 75, 96, 92, 92, 280, array['Tivoli Gardens at dusk with kids', 'Smørrebrød lunch worth planning a day around', 'Harbor swim next to the opera house'])
on conflict (id) do nothing;

insert into public.destinations (id, name, country, tagline, emoji, local_culture, classic_sights, hotel_quality, food_scene, experiences, transit_quality, family_friendly, walkability, daily_cost, highlights)
values ('hoi-an', 'Hội An', 'Vietnam', 'Lantern-lit old town, tailors, and beach afternoons', '🏮', 90, 62, 83, 88, 87, 30, 74, 88, 90, array['Sunrise bike ride through the rice paddies', 'Bánh mì tasting — settle the great debate', 'Basket boat ride the kids will talk about for years'])
on conflict (id) do nothing;

insert into public.destinations (id, name, country, tagline, emoji, local_culture, classic_sights, hotel_quality, food_scene, experiences, transit_quality, family_friendly, walkability, daily_cost, highlights)
values ('kyoto', 'Kyoto', 'Japan', 'Temples, tea houses, and quiet lanes beyond the crowds', '⛩️', 92, 85, 88, 90, 86, 95, 78, 85, 220, array['Stay in a ryokan with kaiseki dinner', 'Morning walk through Fushimi Inari before 8am', 'Nishiki Market food crawl with a local guide'])
on conflict (id) do nothing;

insert into public.destinations (id, name, country, tagline, emoji, local_culture, classic_sights, hotel_quality, food_scene, experiences, transit_quality, family_friendly, walkability, daily_cost, highlights)
values ('lisbon', 'Lisbon', 'Portugal', 'Hilltop neighborhoods, tiled facades, and long dinners', '🚋', 88, 72, 84, 87, 80, 74, 75, 70, 160, array['Fado night in Alfama, booked for 10pm', 'Day trip to Sintra before the tour buses', 'Seafood at a cervejaria, not a tourist grill'])
on conflict (id) do nothing;

insert into public.destinations (id, name, country, tagline, emoji, local_culture, classic_sights, hotel_quality, food_scene, experiences, transit_quality, family_friendly, walkability, daily_cost, highlights)
values ('london', 'London', 'United Kingdom', 'Museums, markets, and neighborhoods that feel like cities', '🎡', 82, 94, 89, 85, 84, 88, 88, 84, 300, array['Borough Market breakfast before the crowds', 'Natural History Museum''s quiet side entrance', 'Theatre night — book the good seats'])
on conflict (id) do nothing;

insert into public.destinations (id, name, country, tagline, emoji, local_culture, classic_sights, hotel_quality, food_scene, experiences, transit_quality, family_friendly, walkability, daily_cost, highlights)
values ('mexico-city', 'Mexico City', 'Mexico', 'World-class food scene wrapped in real neighborhood life', '🌮', 94, 70, 82, 95, 84, 55, 65, 68, 140, array['Counter seats at a Roma Norte taquería omakase', 'Sunday in Coyoacán with the locals', 'Lucha libre night — chaotic, wonderful'])
on conflict (id) do nothing;

insert into public.destinations (id, name, country, tagline, emoji, local_culture, classic_sights, hotel_quality, food_scene, experiences, transit_quality, family_friendly, walkability, daily_cost, highlights)
values ('oaxaca', 'Oaxaca', 'Mexico', 'Mezcal, moles, and markets — culture with zero pretense', '🎨', 96, 55, 76, 93, 85, 40, 62, 82, 110, array['Cooking class that starts at the market', 'Mezcal palenque visit outside town', 'Hierve el Agua at sunrise'])
on conflict (id) do nothing;

insert into public.destinations (id, name, country, tagline, emoji, local_culture, classic_sights, hotel_quality, food_scene, experiences, transit_quality, family_friendly, walkability, daily_cost, highlights)
values ('rome', 'Rome', 'Italy', 'The classics, done right, with carbonara in between', '🏛️', 75, 98, 85, 89, 82, 60, 80, 78, 210, array['Colosseum underground tour, first slot', 'Trastevere dinner away from the menus-with-photos', 'Borghese Gallery — timed entry, never crowded'])
on conflict (id) do nothing;

insert into public.destinations (id, name, country, tagline, emoji, local_culture, classic_sights, hotel_quality, food_scene, experiences, transit_quality, family_friendly, walkability, daily_cost, highlights)
values ('seoul', 'Seoul', 'South Korea', 'Neon markets, palace mornings, and immaculate subways', '🏙️', 89, 74, 87, 91, 83, 97, 76, 80, 180, array['Gwangjang Market bindaetteok at a shared table', 'Hanbok morning at Gyeongbokgung', 'Late-night Han River picnic with delivery chicken'])
on conflict (id) do nothing;

insert into public.destinations (id, name, country, tagline, emoji, local_culture, classic_sights, hotel_quality, food_scene, experiences, transit_quality, family_friendly, walkability, daily_cost, highlights)
values ('vienna', 'Vienna', 'Austria', 'Grand cafés, concert halls, and spotless trams', '🎻', 78, 90, 91, 82, 76, 98, 85, 90, 230, array['Standing tickets at the State Opera for €15', 'Café Sperl afternoon — bring a book', 'Schönbrunn gardens early, palace late'])
on conflict (id) do nothing;
