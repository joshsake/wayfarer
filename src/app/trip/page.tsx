import TripForm from "@/components/TripForm";
import { getDestinations } from "@/lib/destinations";
import { PREF_KEYS } from "@/lib/prefs";

// ---------------------------------------------------------------------------
// The trip form's server half: fetch what the form needs (the list of
// countries actually in the catalog) and pass it down. The interactive form
// itself is a Client Component — same division of labor as the wizard.
// Wizard answers arrive as query params (via the /results link) and are
// forwarded so the plan can be preference-weighted.
// ---------------------------------------------------------------------------

export default async function TripPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const destinations = await getDestinations();
  const countries = [...new Set(destinations.map((d) => d.country))].sort();

  const prefs: Record<string, string> = {};
  for (const key of PREF_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.length > 0) prefs[key] = value;
  }

  return <TripForm countries={countries} prefs={prefs} />;
}
