const firstWords = [
  "Ruhige",
  "Neugierige",
  "Sanfte",
  "Mutige",
  "Kleine",
  "Helle",
  "Freie",
  "Wache",
  "Leichte",
  "Warme",
  "Leise",
  "Bunte",
  "Wilde",
  "Runde",
  "Weiche",
  "Klare",
];
const secondWords = [
  "Wolke",
  "Lichtung",
  "Kiesel",
  "Bergsee",
  "Stern",
  "Wiesenweg",
  "Morgenwind",
  "Zimtstern",
  "Farn",
  "Seerose",
  "Sandbank",
  "Mohnblume",
  "Regentropfen",
  "Abendrot",
  "Kakaobohne",
  "Nordlicht",
];

function randomIndex(length) {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] % length;
  }
  // A pseudonym is a display label, not a credential or security key.
  return Math.floor(Math.random() * length);
}

export function generatePseudonym() {
  const number = String(randomIndex(100)).padStart(2, "0");
  return `${firstWords[randomIndex(firstWords.length)]} ${secondWords[randomIndex(secondWords.length)]} ${number}`;
}
