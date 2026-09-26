export const BOOLEAN_FLAGS = new Set([
  "--help",
  "-h",
  "--draft",
  "--dry-run",
  "--replace-recipients",
  "--no-name-tag",
  "--allow-plain-notes",
  "--all",
  "--json",
  "--html",
  "--quiet",
  "--all-day",
  "--circle",
  "--read-only",
  "--ids-only",
  "--count",
  "--now",
  "--tomorrow",
  "--weekend",
  "--next-week",
  "--seen",
  "--spam",
  "--force",
  "--stats",
  "--styled",
  "--markdown",
  "--allow-partial",
  "-v",
  "--verbose",
]);

export const VALUE_FLAGS = new Set([
  "-m",
  "-o",
  "-t",
  "--account",
  "--occurrence",
  "--apply-to",
  "--api-key",
  "--attachment",
  "--attach",
  "--base-url",
  "--bcc",
  "--box",
  "--calendar",
  "--category",
  "--cc",
  "--color",
  "--config",
  "--content",
  "--cookie",
  "--countdown",
  "--countdown-unit",
  "--date",
  "--days",
  "--domains",
  "--end",
  "--end-time",
  "--ends-on",
  "--events",
  "--exact",
  "--from",
  "--in",
  "--invite",
  "--icon",
  "--label",
  "--limit",
  "--link",
  "--location",
  "--message",
  "--message-html",
  "--name",
  "--none",
  "--notes",
  "--output",
  "--page",
  "--repeat",
  "--repeat-until",
  "--required",
  "--remind",
  "--start",
  "--start-time",
  "--starts-on",
  "--subject",
  "--thread-id",
  "--time-zone",
  "--title",
  "--to",
  "--token",
  "--any",
  "--jq",
  "--content-html",
  "--note",
  "--note-html",
  "--summary",
  "--email",
  "--alias",
  "--account-user-id",
  "--repeat-times",
  "--on",
  "-c",
  "-n",
]);

const ALIASES = { "-h": "--help", "-v": "--verbose", "-m": "--message", "-o": "--output", "-t": "--title", "-c": "--content", "-n": "--note" };

// This is the bridge's supported argv grammar, not a guess at unknown CLI flags.
// Unknown syntax must stop before approval/ownership decisions or execution.
// Keep the original argv: a value such as "--help" or "--account=all" is data.
export function parseHeyArgs(args) {
  const positionals = [];
  const options = [];
  let ended = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (ended || !argument.startsWith("-") || argument === "-") {
      positionals.push(argument);
      continue;
    }
    if (argument === "--") { ended = true; continue; }
    const equals = argument.indexOf("=");
    const spelling = equals < 0 ? argument : argument.slice(0, equals);
    const name = ALIASES[spelling] ?? spelling;
    if (!BOOLEAN_FLAGS.has(spelling) && !VALUE_FLAGS.has(spelling)) {
      throw new Error(`Unsupported HEY option ${spelling}. The app must understand an option before it can safely run it. Use supported full flag names; do not bypass the HEY tool.`);
    }
    const optionIndex = index;
    let value;
    if (BOOLEAN_FLAGS.has(spelling)) {
      value = equals < 0 ? "true" : argument.slice(equals + 1);
      // pflag booleans accept these spellings; verbose is a count, handled separately.
      if (name === "--verbose") {
        if (equals >= 0 && !/^\d+$/.test(value)) throw new Error("Invalid HEY verbose count.");
      } else if (!["true", "false", "1", "0", "t", "f", "T", "F", "TRUE", "FALSE", "True", "False"].includes(value)) {
        throw new Error(`Invalid boolean value for ${name}.`);
      }
    } else {
      if (equals < 0 && index + 1 >= args.length) throw new Error(`Missing value for ${name}.`);
      value = equals < 0 ? args[++index] : argument.slice(equals + 1);
    }
    options.push({ name, value, optionIndex, valueIndex: index, inline: equals >= 0, boolean: BOOLEAN_FLAGS.has(spelling) });
  }
  return {
    positionals,
    options,
    values: (flag) => options.filter((option) => option.name === (ALIASES[flag] ?? flag)).map((option) => option.value),
    has: (flag) => {
      const option = options.findLast((option) => option.name === (ALIASES[flag] ?? flag));
      return !!option && (!option.boolean || !["false", "0", "f"].includes(option.value.toLowerCase()));
    },
  };
}
