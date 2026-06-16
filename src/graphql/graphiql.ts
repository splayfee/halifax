/**
 * Generates an HTML page that renders the GraphiQL IDE, loading assets from unpkg.com CDN.
 * The GraphQL endpoint URL is embedded so GraphiQL points at the correct server path.
 */
export function generateGraphiQLHtml(graphqlPath: string, title: string): string {
  const escapedPath = JSON.stringify(graphqlPath)
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link href="https://unpkg.com/graphiql/graphiql.min.css" rel="stylesheet" />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="graphiql" style="height:100vh;"></div>
  <script crossorigin src="https://unpkg.com/react/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/graphiql/graphiql.min.js" type="application/javascript"></script>
  <script>
    var fetcher = GraphiQL.createFetcher({ url: ${escapedPath} });
    ReactDOM.createRoot(document.getElementById('graphiql')).render(
      React.createElement(GraphiQL, { fetcher: fetcher })
    );
  </script>
</body>
</html>`
}
