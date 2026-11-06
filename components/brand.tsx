export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    // The vector is already sized and does not need image transformation.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/yourcdn.svg"
      width={size}
      height={size}
      alt=""
      className="yourcdn-mark"
    />
  );
}

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "small" : ""}`}>
      <BrandMark size={small ? 27 : 34} />
      <span>YourCDN</span>
    </span>
  );
}
