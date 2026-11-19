// title: Find a tool and call it, returning only a summary
// title_es: Buscar una herramienta y llamarla, devolviendo solo un resumen
// Searches every server for "docs" tools. Replace the call below with one of the results.

const found = await mcp.search('docs search')
log('found', found.matches?.length ?? 0, 'tools')
// Example with Context7, if you have it:
// const libs = await mcp.call('context7', 'resolve-library-id', { libraryName: 'react', query: 'useEffect cleanup' })
// return String(libs).slice(0, 300)
return found.matches?.slice(0, 5) ?? found
