-- Airport codes for flight search. NOT NULL after backfill — same tripwire
-- pattern as lat/lng: a missed row should fail here, not NaN later.
alter table public.destinations add column if not exists iata_code text;

update public.destinations set iata_code = 'KIX' where id = 'kyoto';        -- Kansai
update public.destinations set iata_code = 'LIS' where id = 'lisbon';
update public.destinations set iata_code = 'MEX' where id = 'mexico-city';
update public.destinations set iata_code = 'CPH' where id = 'copenhagen';
update public.destinations set iata_code = 'FCO' where id = 'rome';
update public.destinations set iata_code = 'ICN' where id = 'seoul';
update public.destinations set iata_code = 'OAX' where id = 'oaxaca';
update public.destinations set iata_code = 'LHR' where id = 'london';
update public.destinations set iata_code = 'DAD' where id = 'hoi-an';       -- Da Nang
update public.destinations set iata_code = 'VIE' where id = 'vienna';
update public.destinations set iata_code = 'SIN' where id = 'singapore';

alter table public.destinations alter column iata_code set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'destinations_iata_code_format') then
    alter table public.destinations
      add constraint destinations_iata_code_format check (iata_code ~ '^[A-Z]{3}$');
  end if;
end $$;
