"use client";

// ---------------------------------------------------------------------------
// The preference wizard.
//
// LEARNING NOTE: "use client" marks this as a Client Component — it runs in
// the browser and can hold state (useState) and respond to clicks. Most of a
// Next.js app should stay as Server Components (faster, no JS shipped), and
// you only opt into client-side where you need interactivity. A wizard is
// exactly that place.
//
// DESIGN NOTE (your loan-wizard experience, applied): one question per
// screen, big tap targets, auto-advance on single choice, always a way back,
// progress always visible, and zero jargon. Nobody should feel like they're
// filling in a form.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Preferences, Splurge } from "@/lib/types";

interface Option {
  value: string;
  label: string;
  emoji: string;
  hint: string;
}

interface Step {
  id: keyof Preferences;
  question: string;
  subtitle: string;
  multi?: boolean;
  options: Option[];
}

// The whole wizard is data. Adding a question later = adding an entry here.
const STEPS: Step[] = [
  {
    id: "party",
    question: "Who's going?",
    subtitle: "This shapes everything else, so let's start here.",
    options: [
      { value: "solo", label: "Just me", emoji: "🎒", hint: "Full freedom, my pace" },
      { value: "couple", label: "Me + one", emoji: "🥂", hint: "A trip for two" },
      { value: "family", label: "Kids in tow", emoji: "👨‍👩‍👧", hint: "Family adventure" },
    ],
  },
  {
    id: "vibe",
    question: "What's your kind of trip?",
    subtitle: "Be honest — there are no wrong answers here.",
    options: [
      { value: "local", label: "Live like a local", emoji: "🧺", hint: "Neighborhoods, markets, no tour buses" },
      { value: "mix", label: "A bit of both", emoji: "⚖️", hint: "Some icons, some wandering" },
      { value: "classic", label: "The classics", emoji: "🗼", hint: "The famous sights, done properly" },
    ],
  },
  {
    id: "splurges",
    question: "What's worth spending more on?",
    subtitle: "Pick any that apply — or none, and we'll keep it lean.",
    multi: true,
    options: [
      { value: "hotel", label: "A really nice hotel", emoji: "🛏️", hint: "Where you stay matters" },
      { value: "food", label: "Great restaurants", emoji: "🍽️", hint: "Meals are the itinerary" },
      { value: "experiences", label: "Unique experiences", emoji: "🎟️", hint: "Stories you'll retell" },
    ],
  },
  {
    id: "transit",
    question: "How do you like getting around?",
    subtitle: "No judgment — a bad metro can ruin a good day.",
    options: [
      { value: "clean-transit", label: "Public transit, if it's good", emoji: "🚇", hint: "Clean and organized, or no thanks" },
      { value: "rideshare", label: "Taxis & rideshare", emoji: "🚕", hint: "Door to door, easy" },
      { value: "car", label: "My own wheels", emoji: "🚗", hint: "Rental car freedom" },
    ],
  },
  {
    id: "detail",
    question: "How much planning detail do you want?",
    subtitle: "We'll match you either way — this just sets how much we show.",
    options: [
      { value: "essentials", label: "Just the essentials", emoji: "✨", hint: "Top picks, no homework" },
      { value: "everything", label: "Show me everything", emoji: "🔍", hint: "I like the details" },
    ],
  },
];

export default function Wizard() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({
    splurges: [],
  });

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const progress = useMemo(
    () => Math.round((stepIndex / STEPS.length) * 100),
    [stepIndex],
  );

  /** Send the finished answers to the results page as URL query params.
   *  LEARNING NOTE: putting state in the URL makes results shareable and
   *  refresh-proof — a pattern worth reaching for before global state. */
  function finish(finalAnswers: Record<string, string | string[]>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(finalAnswers)) {
      params.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    router.push(`/results?${params.toString()}`);
  }

  function choose(option: Option) {
    if (step.multi) {
      // Multi-select: toggle the value; user advances with the button.
      const current = (answers[step.id] as string[]) ?? [];
      const next = current.includes(option.value)
        ? current.filter((v) => v !== option.value)
        : [...current, option.value];
      setAnswers({ ...answers, [step.id]: next });
      return;
    }
    // Single-select: record and auto-advance. Feels fast, like a conversation.
    const next = { ...answers, [step.id]: option.value };
    setAnswers(next);
    if (isLast) finish(next);
    else setStepIndex(stepIndex + 1);
  }

  function isSelected(option: Option): boolean {
    const value = answers[step.id];
    return Array.isArray(value)
      ? value.includes(option.value)
      : value === option.value;
  }

  const selectedSplurges = (answers.splurges as Splurge[]) ?? [];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-6 py-10">
      {/* Progress bar */}
      <div className="mb-10">
        <div className="mb-2 flex items-center justify-between text-sm text-stone-500">
          <button
            onClick={() => stepIndex > 0 && setStepIndex(stepIndex - 1)}
            className={`transition-opacity ${stepIndex === 0 ? "pointer-events-none opacity-0" : "hover:text-stone-800"}`}
            data-testid="wizard-back"
          >
            ← Back
          </button>
          <span data-testid="wizard-progress">
            {stepIndex + 1} of {STEPS.length}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
          <div
            className="h-full rounded-full bg-emerald-600 transition-all duration-300"
            style={{ width: `${Math.max(progress, 6)}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <div key={step.id} className="flex flex-1 flex-col">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
          {step.question}
        </h1>
        <p className="mt-2 text-stone-500">{step.subtitle}</p>

        <div className="mt-8 flex flex-col gap-3">
          {step.options.map((option) => (
            <button
              key={option.value}
              onClick={() => choose(option)}
              data-testid={`option-${option.value}`}
              aria-pressed={isSelected(option)}
              className={`group flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all ${
                isSelected(option)
                  ? "border-emerald-600 bg-emerald-50"
                  : "border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50"
              }`}
            >
              <span className="text-3xl">{option.emoji}</span>
              <span>
                <span className="block font-medium text-stone-900">
                  {option.label}
                </span>
                <span className="block text-sm text-stone-500">
                  {option.hint}
                </span>
              </span>
            </button>
          ))}
        </div>

        {/* Multi-select steps need an explicit continue button */}
        {step.multi && (
          <button
            onClick={() => {
              if (isLast) finish(answers);
              else setStepIndex(stepIndex + 1);
            }}
            data-testid="wizard-continue"
            className="mt-8 rounded-full bg-stone-900 px-8 py-3.5 font-medium text-white transition-colors hover:bg-stone-700"
          >
            {selectedSplurges.length === 0
              ? "Keep it lean — continue"
              : "Continue"}
          </button>
        )}
      </div>
    </div>
  );
}
