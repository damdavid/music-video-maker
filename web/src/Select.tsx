type Props<T extends string> = { value: T; options: readonly T[]; onChange: (v: T) => void; label?: (v: T) => string; "aria-label"?: string };

export function Select<T extends string>({ value, options, onChange, label, "aria-label": ariaLabel }: Props<T>) {
  return (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {label ? label(o) : o}
        </option>
      ))}
    </select>
  );
}
