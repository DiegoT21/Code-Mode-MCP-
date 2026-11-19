// title: How many tools does each MCP server have?
// title_es: ¿Cuántas herramientas tiene cada servidor MCP?
// Lists the servers in the panel without loading any tool definition into the conversation.

const { servers } = await mcp.search('')
return servers.length ? servers : 'No MCP servers in the panel yet: use Setup.'
