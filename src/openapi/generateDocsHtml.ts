export function generateDocsHtml(specPath: string, docsPath: string): string {
  // Build a browser-relative URL so it works at any router mount prefix.
  const specParts = specPath.replace(/^\//, '').split('/')
  const docsDirParts = docsPath.replace(/^\//, '').split('/').slice(0, -1)
  const specFilename = specParts[specParts.length - 1] ?? 'openapi.json'
  const specDirParts = specParts.slice(0, -1)
  let common = 0
  while (
    common < specDirParts.length &&
    common < docsDirParts.length &&
    specDirParts[common] === docsDirParts[common]
  )
    common++
  const ups = docsDirParts.length - common
  const downs = specDirParts.slice(common)
  const upSegments: string[] = new Array(ups).fill('..') as string[]
  const relSpecUrl =
    [...upSegments, ...downs, specFilename].join('/') || specFilename

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css" />
  <style>
    body { margin: 0; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: new URL('${relSpecUrl}', window.location.href).href,
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: 'BaseLayout',
        deepLinking: true,
        tryItOutEnabled: true,
        persistAuthorization: true,
        filter: true
      })
    }
  </script>
</body>
</html>`
}
