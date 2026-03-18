#!/bin/bash
# Genera certificato self-signed per DA-INVENT
set -e

CERT_DIR="${1:-data/certs}"
DAYS="${2:-365}"
DOMAIN="${3:-localhost}"

mkdir -p "$CERT_DIR"

openssl req -x509 -newkey rsa:4096 -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" \
  -days "$DAYS" -nodes -subj "/CN=$DOMAIN" \
  -addext "subjectAltName=DNS:$DOMAIN,DNS:*.${DOMAIN},IP:127.0.0.1"

chmod 600 "$CERT_DIR/key.pem"
chmod 644 "$CERT_DIR/cert.pem"

echo ""
echo "✓ Certificato generato in $CERT_DIR/"
echo "  Aggiungi a .env.local:"
echo "    TLS_CERT=$CERT_DIR/cert.pem"
echo "    TLS_KEY=$CERT_DIR/key.pem"
echo ""
