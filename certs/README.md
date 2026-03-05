# Certificates Directory

This directory contains TLS/mTLS certificates for secure sync between e2e-runner instances.

## Quick Start

```bash
# Generate root CA (once)
./scripts/generate-pki.sh init-ca

# Generate hub server certificate
./scripts/generate-pki.sh gen-hub

# Generate agent certificates
./scripts/generate-pki.sh gen-agent laptop-juan
./scripts/generate-pki.sh gen-agent ci-server
```

## Directory Structure

```
certs/
├── ca/
│   ├── ca.pem           # Root CA certificate (share with all instances)
│   └── ca-key.pem       # Root CA private key (KEEP OFFLINE!)
├── hub/
│   ├── hub.pem          # Hub server certificate
│   └── hub-key.pem      # Hub private key
└── agents/
    ├── laptop-juan.pem  # Agent certificate
    └── laptop-juan-key.pem
```

## Security Notes

- **Never commit private keys** - This directory is gitignored
- **Keep CA key offline** - Only use it to sign new certificates
- **Rotate certificates** - Agent certs expire in 90 days
- **Use mTLS in production** - Both hub and agents verify each other

## Configuration

### Hub (e2e.config.js)

```javascript
sync: {
  mode: 'hub',
  hub: {
    tls: {
      enabled: true,
      certPath: './certs/hub/hub.pem',
      keyPath: './certs/hub/hub-key.pem',
      caPath: './certs/ca/ca.pem',
      mtls: true,  // Require client certificates
    }
  }
}
```

### Agent (e2e.config.js)

```javascript
sync: {
  mode: 'agent',
  agent: {
    hubUrl: 'https://hub.example.com:8484',
    instanceId: 'laptop-juan',
    tls: {
      certPath: './certs/agents/laptop-juan.pem',
      keyPath: './certs/agents/laptop-juan-key.pem',
      caPath: './certs/ca/ca.pem',
    }
  }
}
```
