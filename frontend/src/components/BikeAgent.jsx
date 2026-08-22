import BaseAgent from "./BaseAgent.jsx";

const config = {
  apiMode: "bike",
  title: "BikeAgent",
  icon: "🚴‍♀️",
  subtitle: "Cyklotrasy na mieru · Mapa · Predpoveď počasia",
  placeholder: "Zadaj lokalitu, napr. Banská Bystrica",
  idleRoutesLabel: "cyklotrasy",
  historyKey: "bikeagent-history",

  defaultProfile: { hasEbike: true, hasChildren: true, hasTrailer: true },

  profileButtons: [
    { key: "hasEbike",    label: "⚡ E-bike",         depends: null,
      desc: "E-bike: trasy budú optimalizované pre elektrobicykle — zvládnu väčšie prevýšenie a dlhšie trasy." },
    { key: "hasChildren", label: "👨‍👩‍👧 Deti",            depends: null,
      desc: "Deti: trasy budú hodnotené aj podľa vhodnosti a bezpečnosti pre deti (skóre 0–10)." },
    { key: "hasTrailer",  label: "🛻 Prívesný vozík", depends: "hasChildren",
      desc: "Prívesný vozík: trasa musí mať šírku min. 1,5 m, hladký povrch, žiadne schody." },
  ],

  profileIcons: ({ hasEbike, hasChildren, hasTrailer }) =>
    [hasEbike && "⚡", hasChildren && "👧", hasTrailer && "🛻"].filter(Boolean).join(""),

  tipsGroupDesc: profile =>
    !profile.hasChildren ? "cyklistov"
    : profile.hasTrailer ? "e-bike rodinu s prívesným vozíkom"
    : profile.hasEbike    ? "e-bike rodinu s deťmi"
    : "rodinu s deťmi",

  equipment: {
    profileKey: "hasTrailer",
    filterKey:  "trailerOnly",
    routeField: "trailerFriendly",
    label:       "🛻 Prívesný vozík",
    filterLabel: "🛻 Len vozík OK",
  },

  coreBadges: route => [
    { icon: "📏", val: route.distance },
    { icon: "🛣️", val: route.surface },
    { icon: "⛰️", val: route.elevation },
  ],

  extraBadge: (route, profile) => profile.hasEbike
    ? { icon: "⚡", text: "E-bike", bg: "#eff6ff", border: "#bfdbfe", color: "#2563eb" }
    : null,

  mapyPath:    "cyklo",
  komootSport: "touringbicycle",

  theme: {
    bgGradient:    "linear-gradient(150deg, #f0fdf4 0%, #ecfdf5 50%, #f0fdf4 100%)",
    titleGradient: "linear-gradient(120deg, #059669 20%, #0284c7 80%)",
    searchGradient: "linear-gradient(135deg, #10b981, #059669)",
    textColor:      "#064e3b",
    mutedTextColor: "#6b7280",
    accent:          "#059669",
    accentTextColor: "#059669",
    accentDark:      "#047857",
    accentBg:        "#ecfdf5",
    softBorder:      "#d1fae5",
    badgeBg:         "#f0fdf4",
    phaseActiveBorder: "#a7f3d0",
    recommendationColor: "#059669",
    profileBtnShadow: "rgba(5,150,105,0.15)",
    loadingBoxShadow: "rgba(5,150,105,0.1)",
    searchBtnShadow:  "rgba(5,150,105,0.3)",
    summaryShadow:    "rgba(5,150,105,0.08)",
    komootIcon:   "🟢",
    komootBorder: "#6ee7b7",
    komootColor:  "#059669",
    sourceBg:         "#eff6ff",
    sourceBorder:     "#bfdbfe",
    sourceLinkColor:  "#2563eb",
    sourcePlainColor: "#6b7280",
  },
};

export default function BikeAgent() {
  return <BaseAgent config={config} />;
}
