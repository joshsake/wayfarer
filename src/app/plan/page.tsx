import Wizard from "@/components/Wizard";

// LEARNING NOTE: The page itself stays a Server Component; it simply renders
// the interactive Wizard. This keeps the client-side bundle as small as the
// wizard itself, and the route shell renders instantly.

export default function PlanPage() {
  return <Wizard />;
}
