const isUI = Deno.args.includes('--ui')

if (isUI) {
  const { startServer } = await import('@transcriber/server')
  await startServer()
} else {
  const { runCLI } = await import('@transcriber/cli')
  await runCLI()
}

Deno.addSignalListener('SIGINT', () => {
  Deno.exit(0)
})

Deno.addSignalListener('SIGTERM', () => {
  Deno.exit(0)
})
