# Contributing to BrowserPilot

Thank you for your interest in contributing to BrowserPilot!

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/Fire162/browserpilot.git
   cd browserpilot
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the project:
   ```bash
   pnpm build
   ```

4. Run tests:
   ```bash
   pnpm --filter browserpilot-mcp exec tsx test/test-bridge.ts
   ```

## Pull Request Guidelines

- Ensure your code follows clean, readable TypeScript and JavaScript standards.
- Never hardcode or commit IP addresses or private secrets. Always use `<your-vps-ip>` in documentation and examples.
- Make sure existing integration tests pass before submitting your PR.
- Keep PR descriptions concise and focused on the problem being solved.
