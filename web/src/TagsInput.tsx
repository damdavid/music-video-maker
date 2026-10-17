import { useEffect, useState } from "react";

const parse = (text: string) => text.split(",").map((t) => t.trim()).filter(Boolean);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

type Props = { value: string[]; onChange: (tags: string[]) => void };

/**
 * Comma-separated tags. Keeps the raw text locally so typing ", " isn't eaten by re-parsing on every
 * keystroke; the text is only reset when `value` changes from outside (e.g. opening another project).
 */
export function TagsInput({ value, onChange }: Props) {
  const [text, setText] = useState(value.join(", "));

  useEffect(() => {
    if (!same(parse(text), value)) setText(value.join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parse(e.target.value));
      }}
      onBlur={() => setText(value.join(", "))}
    />
  );
}
