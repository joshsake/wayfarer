-- ---------------------------------------------------------------------------
-- Trip splitter: coordinates for route ordering + Singapore.
-- The final SET NOT NULL fails loudly if any row was missed a coordinate —
-- deliberate: a silent null would surface later as NaN distances.
-- ---------------------------------------------------------------------------

alter table public.destinations
  add column if not exists lat double precision,
  add column if not exists lng double precision;

update public.destinations set lat = 35.0116,  lng = 135.7681 where id = 'kyoto';
update public.destinations set lat = 38.7223,  lng = -9.1393  where id = 'lisbon';
update public.destinations set lat = 19.4326,  lng = -99.1332 where id = 'mexico-city';
update public.destinations set lat = 55.6761,  lng = 12.5683  where id = 'copenhagen';
update public.destinations set lat = 41.9028,  lng = 12.4964  where id = 'rome';
update public.destinations set lat = 37.5665,  lng = 126.9780 where id = 'seoul';
update public.destinations set lat = 17.0732,  lng = -96.7266 where id = 'oaxaca';
update public.destinations set lat = 51.5074,  lng = -0.1278  where id = 'london';
update public.destinations set lat = 15.8801,  lng = 108.3380 where id = 'hoi-an';
update public.destinations set lat = 48.2082,  lng = 16.3738  where id = 'vienna';

insert into public.destinations
  (id, name, country, tagline, emoji,
   local_culture, classic_sights, hotel_quality, food_scene, experiences,
   transit_quality, family_friendly, walkability, daily_cost, highlights, lat, lng)
values
  ('singapore', 'Singapore', 'Singapore',
   'Hawker stalls to sky gardens in one spotless city', '🦁',
   62, 78, 95, 96, 82, 98, 92, 74, 190,
   array[
     'Eat across Maxwell and Lau Pa Sat hawker centres',
     'Gardens by the Bay light show at dusk',
     'Kampong Glam, Little India and Katong shophouses',
     'A day on Sentosa or the Southern Ridges walk'
   ],
   1.3521, 103.8198)
on conflict (id) do nothing;

alter table public.destinations
  alter column lat set not null,
  alter column lng set not null;
