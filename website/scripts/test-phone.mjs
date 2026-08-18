import { isE164, normalizeToE164 } from "../lib/phone.js";

const cases = [
  ["5551234567", "+15551234567"],
  ["(555) 123-4567", "+15551234567"],
  ["+1 (555) 123-4567", "+15551234567"],
  ["15551234567", "+15551234567"],
  ["+447911123456", "+447911123456"],
  ["12", ""],
  ["", ""],
];

for (const [input, expected] of cases) {
  const got = normalizeToE164(input);
  if (got !== expected) {
    console.error(`normalizeToE164(${JSON.stringify(input)}) => ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    process.exit(1);
  }
}

if (!isE164("+15551234567") || isE164("5551234567")) {
  console.error("isE164 checks failed.");
  process.exit(1);
}

console.log("phone tests passed");
