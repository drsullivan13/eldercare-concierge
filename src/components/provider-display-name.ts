export function providerDisplayName(name: string) {
  return name === name.toUpperCase()
    ? name
        .toLowerCase()
        .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
        .replace(
          /\b(Llc|Llp|Inc|Cms|Vna|Snf|Nf|Usa|Ii|Iii|Iv)\b/g,
          (word) => word.toUpperCase(),
        )
    : name;
}
