import BaseAgent from "./BaseAgent.jsx";

const config = {
  apiMode: "hike",
  title: "HikeAgent",
  icon: "🥾",
  subtitle: "Turistické trasy na mieru · Mapa · Predpoveď počasia",
  placeholder: "Zadaj lokalitu, napr. Banská Štiavnica",
  idleRoutesLabel: "turistické trasy",
  historyKey: "hikeagent-history",

  defaultProfile: { hasChildren: true, hasStroller: true, hasSeniors: false },

  profileButtons: [
    { key: "hasChildren", label: "👨‍👩‍👧 Deti",       depends: null,
      desc: "Deti: trasy budú hodnotené podľa vhodnosti a bezpečnosti pre deti, vrátane zábavy a odpočinku." },
    { key: "hasStroller", label: "🚼 Kočík/vozík", depends: "hasChildren",
      desc: "Kočík/vozík: trasa musí mať spevnený povrch bez schodov a úzkych prechodov." },
    { key: "hasSeniors",  label: "👴 Seniori",     depends: null,
      desc: "Seniori: uprednostnia sa trasy s lavičkami, oddychovými miestami a toaletami." },
  ],

  profileIcons: ({ hasChildren, hasStroller, hasSeniors }) =>
    [hasChildren && "👧", hasStroller && "🚼", hasSeniors && "👴"].filter(Boolean).join(""),

  tipsGroupDesc: ({ hasChildren, hasStroller, hasSeniors }) => {
    if (hasStroller) return hasChildren ? "rodinu s kočíkom" : "turistov s kočíkom";
    if (hasChildren && hasSeniors) return "rodinu s deťmi a seniormi";
    if (hasChildren) return "rodinu s deťmi";
    if (hasSeniors) return "seniorov";
    return "turistov";
  },

  equipment: {
    profileKey: "hasStroller",
    filterKey:  "strollerOnly",
    routeField: "strollerFriendly",
    label:       "🚼 Kočík/vozík",
    filterLabel: "🚼 Len kočík OK",
  },

  coreBadges: route => [
    { icon: "📏", val: route.distance },
    route.walkingTime && { icon: "⏱️", val: route.walkingTime },
    { icon: "🛤️", val: route.terrain },
    { icon: "⛰️", val: route.elevation },
  ].filter(Boolean),

  extraBadge: route => route.footwearTip
    ? { icon: "🥾", text: route.footwearTip, bg: "#f5f3ff", border: "#ddd6fe", color: "#7c3aed" }
    : null,

  mapyPath:    "turisticka",
  komootSport: "hiking",

  theme: {
    bgGradient:    "linear-gradient(150deg, #fefce8 0%, #fef9c3 50%, #fefce8 100%)",
    titleGradient: "linear-gradient(120deg, #92400e 20%, #d97706 80%)",
    searchGradient: "linear-gradient(135deg, #f59e0b, #d97706)",
    textColor:      "#422006",
    mutedTextColor: "#78716c",
    accent:          "#d97706",
    accentTextColor: "#92400e",
    accentDark:      "#92400e",
    accentBg:        "#fef3c7",
    softBorder:      "#fde68a",
    badgeBg:         "#fefce8",
    phaseActiveBorder: "#fde68a",
    recommendationColor: "#92400e",
    profileBtnShadow: "rgba(217,119,6,0.2)",
    loadingBoxShadow: "rgba(217,119,6,0.12)",
    searchBtnShadow:  "rgba(217,119,6,0.35)",
    summaryShadow:    "rgba(217,119,6,0.1)",
    komootIcon:   "🟤",
    komootBorder: "#fde68a",
    komootColor:  "#92400e",
    sourceBg:         "#fef3c7",
    sourceBorder:     "#fde68a",
    sourceLinkColor:  "#92400e",
    sourcePlainColor: "#78350f",
  },
};

export default function HikeAgent() {
  return <BaseAgent config={config} />;
}
