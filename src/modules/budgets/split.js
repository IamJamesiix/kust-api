// The heart of the app. Pure function, easy to test.
// incomeKobo: BigInt. buckets: [{ label, percent (basis points), colorKey }]
// Floors each bucket, then gives the leftover kobo to the last bucket,
// so the parts ALWAYS add up to the exact income.
export function splitIncome(incomeKobo, buckets) {
  let allocated = 0n

  const parts = buckets.map((b, position) => {
    const amountKobo = (incomeKobo * BigInt(b.percent)) / 10000n
    allocated += amountKobo
    return { label: b.label, colorKey: b.colorKey, percent: b.percent, amountKobo, position }
  })

  parts[parts.length - 1].amountKobo += incomeKobo - allocated
  return parts
}
