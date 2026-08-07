#!/usr/bin/env bash
# setup.sh — Overenie a inštalácia závislostí pre Potulky
# Použitie: bash setup.sh [--yes]   (--yes preskočí všetky potvrdenia)
set -euo pipefail

# ─── Farby a pomocné funkcie ─────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

ok()     { echo -e "  ${GREEN}✓${NC}  $*"; }
warn()   { echo -e "  ${YELLOW}⚠${NC}   $*"; }
fail()   { echo -e "  ${RED}✗${NC}  $*"; }
info()   { echo -e "  ${BLUE}→${NC}  $*"; }
header() { echo -e "\n${BOLD}── $* ──${NC}"; }

ERRORS=0
WARNINGS=0
add_error()   { fail "$*";   ((ERRORS++))   || true; }
add_warning() { warn "$*";   ((WARNINGS++)) || true; }

AUTO_YES=false
[[ "${1:-}" == "--yes" ]] && AUTO_YES=true

confirm() {
  # $1 = otázka, vráti 0 = áno, 1 = nie
  $AUTO_YES && return 0
  read -r -p "  $1 [Y/n] " reply
  [[ "${reply:-Y}" =~ ^[Yy]$ ]]
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Hlavička ────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}Potulky — setup skript${NC}"
echo    "  Adresár projektu: ${SCRIPT_DIR}"
echo    "  Dátum: $(date '+%Y-%m-%d %H:%M')"

# ─── 1. Operačný systém ──────────────────────────────────────────────────────
header "Operačný systém"

OS=""
PKG_MGR=""
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  OS="${ID:-unknown}"
  case "$OS" in
    ubuntu|debian|raspbian) PKG_MGR="apt" ;;
    rhel|centos|rocky|almalinux|fedora) PKG_MGR="dnf" ;;
    *) PKG_MGR="unknown" ;;
  esac
  ok "${PRETTY_NAME:-$OS}"
else
  add_warning "Nepodarilo sa zistiť distribúciu. Automatická inštalácia nemusí fungovať."
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  add_error "Skript je určený pre Linux. Aktuálny systém: $(uname -s)"
fi

# ─── 2. Oprávnenia ───────────────────────────────────────────────────────────
header "Oprávnenia"

SUDO=""
if [[ $EUID -eq 0 ]]; then
  ok "Spustený ako root"
elif command -v sudo &>/dev/null && sudo -n true 2>/dev/null; then
  ok "sudo dostupné (bez hesla)"
  SUDO="sudo"
elif command -v sudo &>/dev/null; then
  ok "sudo dostupné"
  SUDO="sudo"
else
  add_warning "Nie si root a sudo nie je dostupné — automatická inštalácia nebude fungovať."
fi

pkg_install() {
  # $@ = balíky na inštaláciu
  case "$PKG_MGR" in
    apt)
      $SUDO apt-get update -qq
      $SUDO apt-get install -y -qq "$@"
      ;;
    dnf)
      $SUDO dnf install -y -q "$@"
      ;;
    *)
      add_error "Neznámy package manager. Nainštaluj manuálne: $*"
      return 1
      ;;
  esac
}

# ─── 3. Docker ───────────────────────────────────────────────────────────────
header "Docker"

install_docker() {
  info "Inštalujem Docker (oficiálny repozitár)..."
  case "$PKG_MGR" in
    apt)
      pkg_install ca-certificates curl gnupg lsb-release
      $SUDO install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/${OS}/gpg \
        | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      $SUDO chmod a+r /etc/apt/keyrings/docker.gpg
      echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/${OS} $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        | $SUDO tee /etc/apt/sources.list.d/docker.list > /dev/null
      $SUDO apt-get update -qq
      $SUDO apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
      ;;
    dnf)
      $SUDO dnf config-manager --add-repo \
        https://download.docker.com/linux/rhel/docker-ce.repo 2>/dev/null || \
      $SUDO dnf config-manager --add-repo \
        https://download.docker.com/linux/centos/docker-ce.repo
      $SUDO dnf install -y docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
      ;;
    *)
      add_error "Automatická inštalácia Dockeru nie je podporovaná pre $OS."
      info "Inštaluj manuálne: https://docs.docker.com/engine/install/"
      return 1
      ;;
  esac
  $SUDO systemctl enable --now docker
  ok "Docker nainštalovaný"
}

if command -v docker &>/dev/null; then
  DOCKER_VER=$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)
  ok "Docker ${DOCKER_VER}"
else
  fail "Docker nie je nainštalovaný"
  if confirm "Nainštalovať Docker?"; then
    install_docker
  else
    add_error "Docker je povinná závislosť."
  fi
fi

# ─── 4. Docker Compose v2 ────────────────────────────────────────────────────
header "Docker Compose"

if docker compose version &>/dev/null 2>&1; then
  COMPOSE_VER=$(docker compose version --short 2>/dev/null || docker compose version | grep -oP '\d+\.\d+\.\d+' | head -1)
  ok "Docker Compose v${COMPOSE_VER} (plugin)"
else
  fail "Docker Compose v2 plugin nie je dostupný"
  # Skontroluj starú verziu docker-compose
  if command -v docker-compose &>/dev/null; then
    OLD_VER=$(docker-compose --version | grep -oP '\d+\.\d+\.\d+' | head -1)
    warn "Nájdená stará verzia docker-compose v${OLD_VER} — projekt vyžaduje 'docker compose' (v2 plugin)"
  fi
  if confirm "Nainštalovať Docker Compose plugin?"; then
    case "$PKG_MGR" in
      apt)  pkg_install docker-compose-plugin ;;
      dnf)  $SUDO dnf install -y docker-compose-plugin ;;
      *)    add_error "Inštaluj manuálne: https://docs.docker.com/compose/install/" ;;
    esac
    docker compose version &>/dev/null && ok "Docker Compose plugin nainštalovaný" \
      || add_error "Inštalácia Docker Compose pluginu zlyhala."
  else
    add_error "Docker Compose v2 je povinná závislosť."
  fi
fi

# ─── 5. Docker démon beží ────────────────────────────────────────────────────
header "Docker démon"

if docker info &>/dev/null 2>&1; then
  ok "Docker démon beží"
else
  warn "Docker démon nebeží — pokúšam sa spustiť..."
  if $SUDO systemctl start docker 2>/dev/null && docker info &>/dev/null 2>&1; then
    ok "Docker démon spustený"
  else
    add_error "Docker démon sa nepodarilo spustiť. Skontroluj: sudo systemctl status docker"
  fi
fi

# ─── 6. Používateľ v skupine docker ─────────────────────────────────────────
header "Docker skupiny"

if [[ $EUID -eq 0 ]]; then
  ok "Spustený ako root — skupina docker nie je potrebná"
elif groups "$USER" 2>/dev/null | grep -qw docker; then
  ok "Používateľ '$USER' je v skupine docker"
else
  warn "Používateľ '$USER' nie je v skupine docker — príkazy docker vyžadujú sudo"
  if confirm "Pridať '$USER' do skupiny docker?"; then
    $SUDO usermod -aG docker "$USER"
    warn "Zmena skupiny sa prejaví po opätovnom prihlásení (newgrp docker)"
  fi
fi

# ─── 7. Git ─────────────────────────────────────────────────────────────────
header "Git"

if command -v git &>/dev/null; then
  ok "Git $(git --version | grep -oP '\d+\.\d+\.\d+')"
else
  warn "Git nie je nainštalovaný"
  if confirm "Nainštalovať Git?"; then
    pkg_install git && ok "Git nainštalovaný" || add_error "Inštalácia Gitu zlyhala."
  else
    warn "Git nie je povinný ak si projekt skopíroval inak."
  fi
fi

# ─── 8. Súbor .env ──────────────────────────────────────────────────────────
header "Konfigurácia (.env)"

ENV_FILE="${SCRIPT_DIR}/.env"
ENV_EXAMPLE="${SCRIPT_DIR}/.env.example"

if [[ -f "$ENV_FILE" ]]; then
  ok ".env existuje"

  # Skontroluj premenné dynamicky podľa .env.example — nezávisle na tom,
  # čo sa v .env.example pridá/zmení do budúcna (žiadny natvrdo zapísaný
  # zoznam, ktorý by sa mohol rozísť so skutočným stavom projektu).
  MISSING_VARS=()
  if [[ -f "$ENV_EXAMPLE" ]]; then
    while IFS='=' read -r key _; do
      [[ "$key" =~ ^[A-Z_]+$ ]] || continue
      if ! grep -qE "^${key}=.+" "$ENV_FILE" 2>/dev/null; then
        MISSING_VARS+=("$key")
      fi
    done < <(grep -E '^[A-Z_]+=' "$ENV_EXAMPLE")
  fi

  if [[ ${#MISSING_VARS[@]} -eq 0 ]]; then
    ok "Premenné z .env.example sú nastavené"
  else
    add_warning "Chýbajúce alebo prázdne premenné v .env: ${MISSING_VARS[*]}"
    info "Doplň ich do ${ENV_FILE}"
  fi
else
  fail ".env súbor neexistuje"
  if [[ -f "$ENV_EXAMPLE" ]]; then
    if confirm "Vytvoriť .env z .env.example?"; then
      cp "$ENV_EXAMPLE" "$ENV_FILE"
      ok ".env vytvorený — doplň API kľúče v ${ENV_FILE}"
      add_warning "API kľúče nie sú nastavené — aplikácia nespustí bez nich."
    else
      add_error ".env je povinný — aplikácia nespustí bez neho."
    fi
  else
    add_error ".env.example neexistuje — vytvor .env manuálne."
  fi
fi

# ─── 9. Docker sieť 'caddy' ──────────────────────────────────────────────────
header "Docker sieť 'caddy'"

# TLS rieši caddy-docker-proxy automaticky (Let's Encrypt) — appka žiadne
# lokálne certifikáty ani porty 80/443 sama nepublikuje. Jediná skutočná
# závislosť na tomto hostiteľovi je existencia zdieľanej externej siete,
# ktorú docker-compose.yml očakáva ako "external: true".
if docker network inspect caddy &>/dev/null; then
  ok "Externá sieť 'caddy' existuje"
else
  fail "Externá sieť 'caddy' neexistuje"
  if confirm "Vytvoriť sieť 'caddy'? (docker network create caddy)"; then
    if docker network create caddy &>/dev/null; then
      ok "Sieť 'caddy' vytvorená"
    else
      add_error "Vytvorenie siete 'caddy' zlyhalo."
    fi
  else
    add_error "Sieť 'caddy' je povinná — docker-compose.yml ju očakáva ako external."
  fi
fi

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "caddy"; then
  ok "Kontajner 'caddy' (caddy-docker-proxy) beží"
else
  add_warning "Kontajner 'caddy' nebeží — appka síce naštartuje, ale nebude dostupná zvonka cez HTTPS."
fi

# ─── 10. Docker build test ───────────────────────────────────────────────────
header "Docker build"

if [[ $ERRORS -eq 0 ]]; then
  if confirm "Zostaviť Docker obrazy teraz? (docker compose build)"; then
    info "Spúšťam docker compose build..."
    if docker compose -f "${SCRIPT_DIR}/docker-compose.yml" build 2>&1; then
      ok "Docker build úspešný"
    else
      add_error "Docker build zlyhal — skontroluj logy vyššie."
    fi
  else
    info "Build preskočený. Spusti manuálne: docker compose build"
  fi
else
  warn "Build preskočený — najprv oprav chyby vyššie."
fi

# ─── Záver ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}── Výsledok ──${NC}"

if [[ $ERRORS -eq 0 && $WARNINGS -eq 0 ]]; then
  echo -e "\n  ${GREEN}${BOLD}✓ Všetko v poriadku — aplikácia je pripravená na spustenie.${NC}"
  echo ""
  echo "  Spusti aplikáciu:"
  echo "    docker compose up -d"
  echo ""
  echo "  Skontroluj logy:"
  echo "    docker compose logs -f"
elif [[ $ERRORS -eq 0 ]]; then
  echo -e "\n  ${YELLOW}${BOLD}⚠ Dokončené s ${WARNINGS} upozorneniami — skontroluj ich vyššie.${NC}"
  echo ""
  echo "  Spusti aplikáciu:"
  echo "    docker compose up -d"
else
  echo -e "\n  ${RED}${BOLD}✗ Nájdených ${ERRORS} chýb a ${WARNINGS} upozornení — oprav ich pred spustením.${NC}"
  exit 1
fi
