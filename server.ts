const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_API = "https://api.github.com"
const REPO = "coffeegrind123/openclaude"
const PROXY_BASE = process.env.PROXY_BASE_URL || "https://cs16.net/openclaude"
const PORT = parseInt(process.env.PORT || "3457")

if (!GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN is required")
  process.exit(1)
}

function githubHeaders(): Record<string, string> {
  return {
    "User-Agent": "openclaude-release-proxy",
    "Authorization": `Bearer ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
  }
}

function rewriteAssetUrls(release: any): any {
  if (release.assets) {
    release.assets = release.assets.map((asset: any) => ({
      ...asset,
      browser_download_url: `${PROXY_BASE}/download/${asset.id}/${asset.name}`,
    }))
  }
  return release
}

async function fetchBootstrapScript(): Promise<string> {
  const resp = await fetch(
    `${GITHUB_API}/repos/${REPO}/contents/bootstrap.sh`,
    {
      headers: {
        ...githubHeaders(),
        "Accept": "application/vnd.github.raw+json",
      },
    }
  )
  if (!resp.ok) throw new Error(`Failed to fetch bootstrap.sh: ${resp.status}`)
  return resp.text()
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === "/health") {
      return new Response("ok")
    }

    // GET /install.sh or /bootstrap.sh — serve the installer script from repo
    if (path === "/install.sh" || path === "/bootstrap.sh") {
      try {
        const script = await fetchBootstrapScript()
        return new Response(script, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        })
      } catch (e) {
        return new Response(`Failed to fetch install script: ${e}`, { status: 502 })
      }
    }

    // GET /repos/{owner}/{repo}/releases/latest
    // GET /repos/{owner}/{repo}/releases/tags/{tag}
    if (path.startsWith("/repos/")) {
      try {
        const resp = await fetch(`${GITHUB_API}${path}`, { headers: githubHeaders() })
        if (!resp.ok) {
          return new Response(await resp.text(), { status: resp.status })
        }
        const release = await resp.json()
        return Response.json(rewriteAssetUrls(release), {
          headers: { "Cache-Control": "no-cache" },
        })
      } catch (e) {
        return new Response(`Upstream error: ${e}`, { status: 502 })
      }
    }

    // GET /download/{asset_id}/{filename}
    const downloadMatch = path.match(/^\/download\/(\d+)\/(.+)$/)
    if (downloadMatch) {
      const assetId = downloadMatch[1]
      try {
        const resp = await fetch(`${GITHUB_API}/repos/${REPO}/releases/assets/${assetId}`, {
          headers: {
            ...githubHeaders(),
            "Accept": "application/octet-stream",
          },
          redirect: "follow",
        })
        if (!resp.ok) {
          return new Response(await resp.text(), { status: resp.status })
        }
        return new Response(resp.body, {
          headers: {
            "Content-Type": "application/octet-stream",
            ...(resp.headers.get("Content-Length") ? { "Content-Length": resp.headers.get("Content-Length")! } : {}),
          },
        })
      } catch (e) {
        return new Response(`Download error: ${e}`, { status: 502 })
      }
    }

    return new Response("Not Found", { status: 404 })
  },
})

console.log(`OpenClaude release proxy listening on :${PORT}`)
