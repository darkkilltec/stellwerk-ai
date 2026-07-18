// The expected matches in the seed data, explicit instead of implicit.
// This golden set is the shared fixture for the retrieval eval today and
// the LLM re-ranking eval later.
export const goldenSet: { job: string; expect: string }[] = [
  { job: "checkout-plattform", expect: "fullstack-ts" },
  { job: "fincore-platform", expect: "go-platform" },
  { job: "matching-ranking", expect: "nlp-data-scientist" },
  { job: "medidata-sre", expect: "devops-sre" },
  { job: "klarwerk-design-system", expect: "frontend-design-system" },
];
