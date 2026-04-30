export function weatherInfo(code) {
  if (code === 0) return { icon: "☀️", label: "Jasno" };
  if (code <= 3)  return { icon: "⛅", label: "Polojasno" };
  if (code <= 48) return { icon: "🌫️", label: "Hmla" };
  if (code <= 55) return { icon: "🌦️", label: "Mrholenie" };
  if (code <= 65) return { icon: "🌧️", label: "Dážď" };
  if (code <= 77) return { icon: "❄️", label: "Sneh" };
  if (code <= 82) return { icon: "🌧️", label: "Prehánky" };
  if (code <= 86) return { icon: "🌨️", label: "Snehové prehánky" };
  return { icon: "⛈️", label: "Búrka" };
}
