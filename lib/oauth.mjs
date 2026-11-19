// Sign-in (OAuth) for remote MCP servers behind the gateway.
//
// The user signs in once from the panel (Inventory → server → Sign in): the browser opens the server's login
// page, comes back to http://localhost:<port>/oauth/callback/<server>, and the tokens are kept in
// ~/.code-mode-mcp/oauth/<server>.json (in the user's folder, never shown). After that the gateway uses and
// refreshes them by itself. Works with servers that support dynamic client registration (the MCP standard).

import fs from 'node:fs'
import path from 'node:path'
import { PATHS, PORT, readJson, writeJson } from './config.mjs'

const DIR = path.join(PATHS.home, 'oauth')
const fileFor = (server) => path.join(DIR, `${server.replace(/[^\w.-]+/g, '_')}.json`)

export class NeedsSignIn extends Error {
  constructor(server) {
    super(`"${server}" needs you to sign in: open the Code Mode panel → Inventory → ${server} → Sign in.`)
    this.server = server
  }
}

export class FileOAuthProvider {
  // interactive: from the panel (keeps the login URL so the page can open it); otherwise (the gateway) a
  // missing sign-in becomes a clear error instead of trying to open a browser.
  constructor(server, { interactive = false } = {}) {
    this.server = server
    this.interactive = interactive
    this.pendingUrl = null
  }
  read() {
    return readJson(fileFor(this.server), {})
  }
  write(patch) {
    writeJson(fileFor(this.server), { ...this.read(), ...patch }, { private: true })
  }
  get redirectUrl() {
    return `http://localhost:${PORT}/oauth/callback/${encodeURIComponent(this.server)}`
  }
  get clientMetadata() {
    return {
      client_name: 'Code Mode MCP',
      client_uri: 'https://github.com/DiegoT21/Code-Mode-MCP-',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }
  clientInformation() {
    return this.read().client
  }
  saveClientInformation(client) {
    this.write({ client })
  }
  tokens() {
    return this.read().tokens
  }
  saveTokens(tokens) {
    this.write({ tokens, savedAt: new Date().toISOString() })
  }
  saveCodeVerifier(codeVerifier) {
    this.write({ codeVerifier })
  }
  codeVerifier() {
    const v = this.read().codeVerifier
    if (!v) throw new Error('No sign-in in progress for this server')
    return v
  }
  redirectToAuthorization(url) {
    if (!this.interactive) throw new NeedsSignIn(this.server)
    this.pendingUrl = url.toString()
  }
  invalidateCredentials(scope) {
    const d = this.read()
    if (scope === 'all') fs.rmSync(fileFor(this.server), { force: true })
    else if (scope === 'tokens') this.write({ tokens: undefined })
    else if (scope === 'client') this.write({ client: undefined })
    else if (scope === 'verifier') this.write({ codeVerifier: undefined })
    return d
  }
}

export const signedIn = (server) => !!readJson(fileFor(server), {}).tokens
export function signOut(server) {
  fs.rmSync(fileFor(server), { force: true })
}
