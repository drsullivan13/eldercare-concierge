export const familyScenarios = [
  {
    id: "home-care-chris",
    label: "Crisis-mode Chris",
    start: "Within 48–72 hours",
    situation:
      "My mother is 74 and lives in Morristown. She fell and is coming home from the hospital. I live in Boston and am looking for 20–40 hours of non-medical help each week.",
    question: "Could someone help my mother at home when she is discharged?",
  },
  {
    id: "home-care-priya",
    label: "Proactive Priya",
    start: "Next week",
    situation:
      "My father is 79 and lives alone in Edison. After missed medications and a minor car accident, I’m looking from Chicago for 8–15 hours of light help each week and rides.",
    question:
      "Could we start with a few short visits each week and help with rides?",
  },
  {
    id: "home-care-rob",
    label: "Remote-by-time Rob",
    start: "Within a few days",
    situation:
      "My parents live in Montclair. I work in Manhattan and can’t get away for their weekday appointments. We need rides and 10–20 hours of weekday support.",
    question:
      "Could a caregiver cover weekday appointments and keep me updated?",
  },
] as const;

type FamilyBrief = {
  label: (typeof familyScenarios)[number]["label"];
  start: string;
  situation: string;
  question: string;
};

// Keep this plain-text handoff readable in older archives and in the voice lab.
export function familyQuestion({
  label,
  start,
  situation,
  question,
}: FamilyBrief): string {
  return [
    `Family scenario: ${label}`,
    `Requested start: ${start.trim()}`,
    `Situation: ${situation.trim().replace(/\s+/g, " ")}`,
    question.trim(),
  ]
    .join("\n")
    .trimEnd();
}

export function readFamilyQuestion(value: string): FamilyBrief | undefined {
  const [family, start, situation, ...rest] = value.split("\n");
  const scenario = familyScenarios.find(
    ({ label }) => family === `Family scenario: ${label}`,
  );
  if (
    !scenario ||
    !start?.startsWith("Requested start: ") ||
    !situation?.startsWith("Situation: ")
  )
    return;
  return {
    label: scenario.label,
    start: start.slice("Requested start: ".length),
    situation: situation.slice("Situation: ".length),
    question: rest.join("\n"),
  };
}
