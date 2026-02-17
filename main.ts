// Set up process termination handlers
function setupProcessHandlers() {
  // Handle uncaught exceptions
  globalThis.addEventListener('error', (event) => {
    console.error('Uncaught error:', event.error)
    Deno.exit(1)
  })

  // Handle unhandled promise rejections
  globalThis.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason)
    Deno.exit(1)
  })

  // Handle SIGINT (Ctrl+C)
  Deno.addSignalListener('SIGINT', () => {
    console.log('SIGINT received, shutting down...')
    Deno.exit(0)
  })

  // Handle SIGTERM
  Deno.addSignalListener('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...')
    Deno.exit(0)
  })
}

// Set up process handlers
setupProcessHandlers()

// Check if the --ui flag is provided
const useUI = Deno.args.includes('--ui')

if (useUI) {
  try {
    // Dynamically import the UI application only when needed
    const { TranscriberUI } = await import('./src/app/ui/index.ts')
    const ui = new TranscriberUI()

    try {
      await ui.run()
      console.log('UI application completed successfully')
      Deno.exit(0)
    } catch (error) {
      console.error('Error running UI application:', error)
      Deno.exit(1)
    }
  } catch (error) {
    console.error('Error loading UI application:', error)
    console.error('Make sure you have the required dependencies installed.')
    console.error('Try running without the --ui flag to use the CLI version.')
    Deno.exit(1)
  }
} else {
  // Run the CLI application
  try {
    const { runCLI } = await import('./src/app/cli/index.ts')
    await runCLI()
    console.log('CLI application completed successfully')
    Deno.exit(0)
  } catch (error) {
    console.error('Error running CLI application:', error)
    Deno.exit(1)
  }
}
