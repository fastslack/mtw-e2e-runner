#!/bin/bash
#
# E2E Runner - PKI Certificate Generation Scripts
#
# This script generates certificates for TLS/mTLS authentication between
# hub and agent instances.
#
# Usage:
#   ./scripts/generate-pki.sh init-ca           # Generate root CA (once)
#   ./scripts/generate-pki.sh gen-hub           # Generate hub server cert
#   ./scripts/generate-pki.sh gen-agent <name>  # Generate agent client cert
#   ./scripts/generate-pki.sh list              # List all certificates
#
# Requirements:
#   - OpenSSL
#
# Output:
#   certs/
#   ├── ca/
#   │   ├── ca.pem           # Root CA certificate
#   │   ├── ca-key.pem       # Root CA private key (KEEP SECRET!)
#   │   └── ca.srl           # Serial number file
#   ├── hub/
#   │   ├── hub.pem          # Hub server certificate
#   │   └── hub-key.pem      # Hub private key
#   └── agents/
#       ├── <name>.pem       # Agent certificate
#       └── <name>-key.pem   # Agent private key

set -e

CERTS_DIR="${CERTS_DIR:-./certs}"
CA_DIR="$CERTS_DIR/ca"
HUB_DIR="$CERTS_DIR/hub"
AGENTS_DIR="$CERTS_DIR/agents"

# Certificate validity (days)
CA_DAYS=3650      # 10 years
HUB_DAYS=365      # 1 year
AGENT_DAYS=90     # 90 days

# Default values
CA_CN="${CA_CN:-E2E Runner Root CA}"
HUB_CN="${HUB_CN:-e2e-runner-hub}"
ORG="${ORG:-E2E Runner}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

#
# Initialize Root CA
#
init_ca() {
  if [ -f "$CA_DIR/ca.pem" ]; then
    log_warn "CA already exists at $CA_DIR/ca.pem"
    log_warn "Delete it first if you want to regenerate"
    exit 1
  fi
  
  log_info "Creating certificate directories..."
  mkdir -p "$CA_DIR" "$HUB_DIR" "$AGENTS_DIR"
  
  log_info "Generating Root CA private key..."
  openssl genrsa -out "$CA_DIR/ca-key.pem" 4096
  chmod 600 "$CA_DIR/ca-key.pem"
  
  log_info "Generating Root CA certificate..."
  openssl req -new -x509 \
    -key "$CA_DIR/ca-key.pem" \
    -out "$CA_DIR/ca.pem" \
    -days $CA_DAYS \
    -subj "/O=$ORG/CN=$CA_CN"
  
  # Initialize serial number
  echo "1000" > "$CA_DIR/ca.srl"
  
  log_info "Root CA created successfully!"
  echo ""
  echo "CA Certificate: $CA_DIR/ca.pem"
  echo "CA Private Key: $CA_DIR/ca-key.pem (KEEP SECRET!)"
  echo ""
  log_warn "The CA private key should be kept offline in production!"
}

#
# Generate Hub Server Certificate
#
gen_hub() {
  if [ ! -f "$CA_DIR/ca.pem" ]; then
    log_error "CA not found. Run 'init-ca' first."
    exit 1
  fi
  
  local hub_cn="${1:-$HUB_CN}"
  
  log_info "Generating Hub private key..."
  openssl genrsa -out "$HUB_DIR/hub-key.pem" 2048
  chmod 600 "$HUB_DIR/hub-key.pem"
  
  log_info "Generating Hub CSR..."
  openssl req -new \
    -key "$HUB_DIR/hub-key.pem" \
    -out "$HUB_DIR/hub.csr" \
    -subj "/O=$ORG/CN=$hub_cn"
  
  # Create extension file for SAN
  cat > "$HUB_DIR/hub-ext.cnf" <<EOF
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = $hub_cn
IP.1 = 127.0.0.1
EOF
  
  log_info "Signing Hub certificate..."
  openssl x509 -req \
    -in "$HUB_DIR/hub.csr" \
    -CA "$CA_DIR/ca.pem" \
    -CAkey "$CA_DIR/ca-key.pem" \
    -CAserial "$CA_DIR/ca.srl" \
    -out "$HUB_DIR/hub.pem" \
    -days $HUB_DAYS \
    -extfile "$HUB_DIR/hub-ext.cnf"
  
  rm -f "$HUB_DIR/hub.csr" "$HUB_DIR/hub-ext.cnf"
  
  log_info "Hub certificate created successfully!"
  echo ""
  echo "Certificate: $HUB_DIR/hub.pem"
  echo "Private Key: $HUB_DIR/hub-key.pem"
  echo "Valid for: $HUB_DAYS days"
  echo ""
  echo "Configure in e2e.config.js:"
  echo "  sync: {"
  echo "    mode: 'hub',"
  echo "    hub: {"
  echo "      tls: {"
  echo "        enabled: true,"
  echo "        certPath: '$HUB_DIR/hub.pem',"
  echo "        keyPath: '$HUB_DIR/hub-key.pem',"
  echo "        caPath: '$CA_DIR/ca.pem',"
  echo "        mtls: true,"
  echo "      }"
  echo "    }"
  echo "  }"
}

#
# Generate Agent Client Certificate
#
gen_agent() {
  local name="$1"
  
  if [ -z "$name" ]; then
    log_error "Agent name required. Usage: gen-agent <name>"
    exit 1
  fi
  
  if [ ! -f "$CA_DIR/ca.pem" ]; then
    log_error "CA not found. Run 'init-ca' first."
    exit 1
  fi
  
  local agent_file="$AGENTS_DIR/$name"
  
  if [ -f "${agent_file}.pem" ]; then
    log_warn "Certificate for '$name' already exists."
    read -p "Overwrite? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      exit 0
    fi
  fi
  
  log_info "Generating Agent '$name' private key..."
  openssl genrsa -out "${agent_file}-key.pem" 2048
  chmod 600 "${agent_file}-key.pem"
  
  log_info "Generating Agent CSR..."
  openssl req -new \
    -key "${agent_file}-key.pem" \
    -out "${agent_file}.csr" \
    -subj "/O=$ORG/CN=$name"
  
  # Create extension file for client auth
  cat > "${agent_file}-ext.cnf" <<EOF
basicConstraints = CA:FALSE
keyUsage = digitalSignature
extendedKeyUsage = clientAuth
EOF
  
  log_info "Signing Agent certificate..."
  openssl x509 -req \
    -in "${agent_file}.csr" \
    -CA "$CA_DIR/ca.pem" \
    -CAkey "$CA_DIR/ca-key.pem" \
    -CAserial "$CA_DIR/ca.srl" \
    -out "${agent_file}.pem" \
    -days $AGENT_DAYS \
    -extfile "${agent_file}-ext.cnf"
  
  rm -f "${agent_file}.csr" "${agent_file}-ext.cnf"
  
  log_info "Agent certificate created successfully!"
  echo ""
  echo "Certificate: ${agent_file}.pem"
  echo "Private Key: ${agent_file}-key.pem"
  echo "Valid for: $AGENT_DAYS days"
  echo ""
  echo "Configure in e2e.config.js:"
  echo "  sync: {"
  echo "    mode: 'agent',"
  echo "    agent: {"
  echo "      instanceId: '$name',"
  echo "      tls: {"
  echo "        certPath: '${agent_file}.pem',"
  echo "        keyPath: '${agent_file}-key.pem',"
  echo "        caPath: '$CA_DIR/ca.pem',"
  echo "      }"
  echo "    }"
  echo "  }"
}

#
# List all certificates
#
list_certs() {
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  E2E Runner Certificates"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  
  # CA
  if [ -f "$CA_DIR/ca.pem" ]; then
    echo -e "${GREEN}[CA]${NC} Root CA"
    openssl x509 -in "$CA_DIR/ca.pem" -noout -subject -dates 2>/dev/null | sed 's/^/  /'
    echo ""
  else
    echo -e "${YELLOW}[CA]${NC} Not created. Run: init-ca"
    echo ""
  fi
  
  # Hub
  if [ -f "$HUB_DIR/hub.pem" ]; then
    echo -e "${GREEN}[HUB]${NC} Hub Server"
    openssl x509 -in "$HUB_DIR/hub.pem" -noout -subject -dates 2>/dev/null | sed 's/^/  /'
    echo ""
  else
    echo -e "${YELLOW}[HUB]${NC} Not created. Run: gen-hub"
    echo ""
  fi
  
  # Agents
  echo "Agents:"
  local count=0
  for cert in "$AGENTS_DIR"/*.pem; do
    if [ -f "$cert" ]; then
      local name=$(basename "$cert" .pem)
      echo -e "  ${GREEN}*${NC} $name"
      openssl x509 -in "$cert" -noout -dates 2>/dev/null | sed 's/^/    /'
      ((count++)) || true
    fi
  done
  
  if [ $count -eq 0 ]; then
    echo -e "  ${YELLOW}No agents. Run: gen-agent <name>${NC}"
  fi
  
  echo ""
}

#
# Verify a certificate
#
verify_cert() {
  local cert="$1"
  
  if [ ! -f "$cert" ]; then
    log_error "Certificate not found: $cert"
    exit 1
  fi
  
  if [ ! -f "$CA_DIR/ca.pem" ]; then
    log_error "CA not found. Cannot verify."
    exit 1
  fi
  
  log_info "Verifying certificate..."
  if openssl verify -CAfile "$CA_DIR/ca.pem" "$cert" 2>/dev/null; then
    log_info "Certificate is valid and trusted by CA"
  else
    log_error "Certificate verification failed!"
    exit 1
  fi
  
  echo ""
  echo "Certificate details:"
  openssl x509 -in "$cert" -noout -text | grep -A 2 "Subject:\|Issuer:\|Validity" | head -20
}

#
# Main
#
case "${1:-help}" in
  init-ca)
    init_ca
    ;;
  gen-hub)
    gen_hub "$2"
    ;;
  gen-agent)
    gen_agent "$2"
    ;;
  list)
    list_certs
    ;;
  verify)
    verify_cert "$2"
    ;;
  help|--help|-h)
    echo ""
    echo "E2E Runner PKI Certificate Generator"
    echo ""
    echo "Usage:"
    echo "  $0 init-ca              Generate root CA (run once)"
    echo "  $0 gen-hub [name]       Generate hub server certificate"
    echo "  $0 gen-agent <name>     Generate agent client certificate"
    echo "  $0 list                 List all certificates"
    echo "  $0 verify <cert>        Verify a certificate"
    echo ""
    echo "Environment variables:"
    echo "  CERTS_DIR    Certificate directory (default: ./certs)"
    echo "  CA_CN        CA common name"
    echo "  HUB_CN       Hub common name"
    echo "  ORG          Organization name"
    echo ""
    ;;
  *)
    log_error "Unknown command: $1"
    echo "Run '$0 help' for usage"
    exit 1
    ;;
esac
