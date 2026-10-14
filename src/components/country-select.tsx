import { OTHER_COUNTRIES, POPULAR_COUNTRIES } from "@/lib/countries";

/**
 * One country picker, used everywhere a country is chosen.
 *
 * Three screens each grew their own `<select>` over a hand-written
 * list, and they ended up offering 48, 36 and 8 countries respectively.
 * A user filed an issue asking how to add more, having landed on the
 * one that offered eight.
 *
 * Grouped rather than one flat list of 272: the twenty people actually
 * pick sit at the top, and the rest are there when somebody needs
 * Vietnam. A native select is deliberate — it is searchable by typing
 * on every platform, including mobile, with no JavaScript.
 */
export function CountrySelect({
  id = "country",
  name = "country",
  defaultValue = "US",
  className,
  required,
}: {
  id?: string;
  name?: string;
  defaultValue?: string;
  className?: string;
  required?: boolean;
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      required={required}
      className={
        className ??
        "flex h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 py-1 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
      }
    >
      <optgroup label="Most used">
        {POPULAR_COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} · {c.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="All countries">
        {OTHER_COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} · {c.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
