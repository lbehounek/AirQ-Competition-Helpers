# Security Guidelines

## Vite Development Server Security

### ⚠️ Critical: Never Expose Dev Server to Network

**DO NOT** run the development server with network exposure:
```bash
# ❌ DANGEROUS - Never do this
npm run dev -- --host
npm run dev -- --host 0.0.0.0
vite --host
```

### Why This Matters

When the Vite dev server is exposed to the network, it becomes vulnerable to:

1. **File System Access**: Attackers can read ANY file the process can access:
   - `.env` files containing API keys, database passwords
   - SSH private keys (`~/.ssh/id_rsa`)
   - Source code from other projects
   - System configuration files

2. **Attack Examples**:
   ```bash
   # Read environment secrets
   curl http://your-ip:5173/../.env
   
   # Access SSH keys
   curl http://your-ip:5173/../../../.ssh/id_rsa
   
   # Read arbitrary files
   curl http://your-ip:5173/../../../etc/passwd
   ```

### Safe Development Practices

✅ **Recommended**: Always develop on localhost only:
```bash
npm run dev
# Server runs on http://localhost:5173 (safe)
```

✅ **For mobile testing**: Use ngrok or similar tunneling service:
```bash
# Install ngrok
npm install -g ngrok

# In one terminal: start dev server (localhost only)
npm run dev

# In another terminal: create secure tunnel
ngrok http 5173
# Use the https://xyz.ngrok.io URL for mobile testing
```

### Security Hardening Applied

Both Vite configs in this project include:

1. **Explicit localhost binding**: `host: 'localhost'`
2. **File system deny rules**: Block access to sensitive paths
3. **Preview server protection**: Same rules apply to `npm run preview`

### Emergency Response

If you accidentally exposed the dev server:
1. **Immediately stop the server** (Ctrl+C)
2. **Rotate any API keys/secrets** that were in environment files
3. **Check for unauthorized access** in server logs
4. **Review and update** any compromised credentials

### Additional Security Measures Applied

✅ **CORS Restrictions**: Both apps restrict cross-origin requests to localhost (IPv4 + IPv6)
✅ **File System Deny Rules**: Block sensitive paths while allowing node_modules for Vite functionality  
✅ **Environment File Protection**: `.env*` files explicitly denied and gitignored
✅ **Preview Server Hardening**: Same localhost-only restrictions apply
✅ **Balanced Security**: Protects against path traversal without breaking dev server functionality

### Team Policy

- Never use `--host` flag in development
- No symlinks in `public/` directories  
- Keep Vite updated to latest versions
- Use secure tunneling for mobile/network testing
- Rotate API keys immediately if dev server was accidentally exposed
- Use `.env.example` template for new environment setup
